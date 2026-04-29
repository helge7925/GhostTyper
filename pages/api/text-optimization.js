import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { optimizeText } from '../../lib/ai-service';
import {
  CostLimitCheckUnavailableError,
  CostLimitExceededError,
  enforceProjectedBudgetGuardrail,
  estimateTextTransformCost,
  logUsage,
  checkCostLimit,
  withUserCostLock,
} from '../../lib/usage';
import { getSettingsRow, resolveStoredApiKey } from '../../lib/settings-service';
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'text-optimization',
    identifier: `user:${session.user.id}`,
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
    const settingsRow = await getSettingsRow(session.user.id);
    const apiKey = resolveStoredApiKey(settingsRow) || process.env.MISTRAL_API_KEY;
    const preferredModel = resolveChatModel(requestModel || settingsRow?.preferred_model || 'mistral-large-latest');

    if (!apiKey) {
      return res.status(400).json({ message: 'Kein Mistral API-Key konfiguriert' });
    }
    if (!preferredModel) {
      return res.status(400).json({ message: 'Ungültiges KI-Modell' });
    }

    const optimizedText = await withUserCostLock(session.user.id, async () => {
      const costCheck = await checkCostLimit(session.user.id);
      if (!costCheck.allowed) {
        throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
      }
      const estimatedCost = estimateTextTransformCost(preferredModel, text, {
        inputBufferTokens: 120,
        outputMultiplier: 0.9,
        outputBufferTokens: 120,
      });
      await enforceProjectedBudgetGuardrail(session.user.id, estimatedCost);

      const result = await optimizeText(
        text,
        preset,
        typeof customInstruction === 'string' ? customInstruction.trim() : '',
        apiKey,
        preferredModel
      );
      await logUsage(session.user.id, result.model, 'text_optimization', result.usage);
      return result.optimizedText;
    });

    await logAuditEvent({
      userId: session.user.id,
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
