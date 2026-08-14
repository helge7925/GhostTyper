import { optimizeText } from '../../lib/ai-service';
import { withOrgScope } from '../../lib/api/with-org-scope';
import { composeAbortSignals, executeReservedSpend, estimateTextUsage, requestBudgetScope } from '../../lib/budget-runtime';
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
    const preferredModel = resolveChatModel(requestModel, null)
      || resolveChatModel(settingsRow?.preferred_model, null)
      || cortecs.chatModel;

    if (!cortecs.apiKey) {
      return res.status(400).json({ message: 'Kein Cortecs API-Key konfiguriert' });
    }
    if (!preferredModel) {
      return res.status(400).json({ message: 'Ungültiges KI-Modell' });
    }

    const result = await executeReservedSpend(
      {
        idempotencyKey: requestBudgetScope(req, 'text-optimization', { text, preset, customInstruction, preferredModel }),
        organizationId: orgId,
        userId,
        operation: 'text_optimization',
        provider: 'cortecs',
        model: preferredModel,
        estimatedUsage: estimateTextUsage(text, {
          inputBufferTokens: 320,
          outputMultiplier: 1.1,
          outputBufferTokens: 192,
        }),
      },
      (_reservation, budgetSignal) => optimizeText(
        text,
        preset,
        typeof customInstruction === 'string' ? customInstruction.trim() : '',
        cortecs.apiKey,
        preferredModel,
        { baseUrl: cortecs.baseUrl, preference: cortecs.preference, signal: composeAbortSignals(budgetSignal) },
      ),
    );
    const optimizedText = result.optimizedText;

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
    if (error?.code === 'BUDGET_EXCEEDED') {
      return res.status(429).json({ message: error.message });
    }
    if (error?.code === 'BUDGET_ACCOUNTING_UNAVAILABLE' || error?.code === 'PRICING_CONFIGURATION_MISSING') {
      return res.status(503).json({ message: error.message });
    }
    logApiError('Text optimization error', error);
    return serverError(res, 'Textoptimierung fehlgeschlagen');
  }
}

export default withOrgScope({ permission: 'paid.execute' }, handler);
