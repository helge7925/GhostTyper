import { optimizeText } from '../../lib/ai-service';
import { withOrgScope } from '../../lib/api/with-org-scope';
import {
  CostLimitCheckUnavailableError,
  CostLimitExceededError,
  enforceProjectedBudgetGuardrail,
  estimateTextTransformCost,
  logUsage,
  checkCostLimit,
  withUserCostLock,
} from '../../lib/usage';
import { getSettingsRow, resolveCortecsConfig } from '../../lib/settings-service';
import { resolveChatModel } from '../../lib/model-policy';
import { MAX_TEXT_OPTIMIZATION_INPUT_LENGTH, MAX_CUSTOM_PROMPT_LENGTH } from '../../lib/constants';
import { enforceRateLimit, logApiError, serverError } from '../../lib/api-utils';
import { logAuditEvent } from '../../lib/audit-log';

const ALLOWED_PRESETS = new Set([
  'spelling_grammar',
  'friendlier',
  'more_formal',
  'shorter',
  'clearer',
  'email_improve',
]);

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'text-optimization',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const {
    text,
    preset = 'clearer',
    customInstruction = '',
    model: requestModel,
  } = req.body || {};

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ message: 'Text ist erforderlich' });
  }
  if (text.length > MAX_TEXT_OPTIMIZATION_INPUT_LENGTH) {
    return res.status(400).json({ message: `Text ist zu lang (max. ${MAX_TEXT_OPTIMIZATION_INPUT_LENGTH} Zeichen)` });
  }
  if (!ALLOWED_PRESETS.has(preset)) {
    return res.status(400).json({ message: 'Ungültiges Optimierungs-Preset' });
  }
  if (typeof customInstruction === 'string' && customInstruction.length > MAX_CUSTOM_PROMPT_LENGTH) {
    return res.status(400).json({ message: `Zusätzliche Anweisung ist zu lang (max. ${MAX_CUSTOM_PROMPT_LENGTH} Zeichen)` });
  }

  try {
    const settingsRow = await getSettingsRow(userId);
    const cortecs = await resolveCortecsConfig({ userId, organizationId: req.org?.id });
    const apiKey = cortecs.apiKey;
    const preferredModel = resolveChatModel(requestModel || cortecs.chatModel || settingsRow?.preferred_model) || cortecs.chatModel;

    if (!apiKey) {
      return res.status(400).json({ message: 'Kein Cortecs API-Key konfiguriert' });
    }
    if (!preferredModel) {
      return res.status(400).json({ message: 'Ungültiges KI-Modell' });
    }

    const optimizedText = await withUserCostLock(userId, async () => {
      const costCheck = await checkCostLimit(userId, orgId);
      if (!costCheck.allowed) {
        throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
      }
      const estimatedCost = estimateTextTransformCost(preferredModel, text, {
        inputBufferTokens: 120,
        outputMultiplier: 0.9,
        outputBufferTokens: 120,
      });
      await enforceProjectedBudgetGuardrail(userId, estimatedCost, orgId);

      const result = await optimizeText(
        text,
        preset,
        typeof customInstruction === 'string' ? customInstruction.trim() : '',
        apiKey,
        preferredModel,
        { baseUrl: cortecs.baseUrl, preference: cortecs.preference }
      );
      await logUsage(userId, result.model, 'text_optimization', result.usage, orgId);
      return result.optimizedText;
    });

    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: 'text_optimization.completed',
      targetType: 'text_optimization',
      metadata: {
        preset,
        model: preferredModel,
        inputChars: text.length,
      },
    });

    return res.status(200).json({ optimizedText });
  } catch (error) {
    if (error?.code === 'COST_LIMIT_EXCEEDED' || error?.code === 'BUDGET_GUARDRAIL_EXCEEDED') {
      return res.status(429).json({ message: error.message });
    }
    if (error instanceof CostLimitCheckUnavailableError || error?.code === 'COST_CHECK_UNAVAILABLE') {
      return res.status(503).json({ message: error.message });
    }
    logApiError('Text optimization error', error);
    return serverError(res, 'Textoptimierung fehlgeschlagen');
  }
}

export default withOrgScope(handler);
