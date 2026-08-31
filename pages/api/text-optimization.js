import { optimizeText } from '../../lib/ai-service';
import { withOrgScope } from '../../lib/api/with-org-scope';
import { composeAbortSignals, executeReservedSpend, estimateTextUsage, requestBudgetScope } from '../../lib/budget-runtime';
import { getSettingsRow } from '../../lib/settings-service';
import { resolveConfiguredModel } from '../../lib/openrouter';
import { optimizeTextEdenAi } from '../../lib/edenai-service';
import { resolveActiveProviderConfig } from '../../lib/ai-provider-router';
import { MAX_TEXT_OPTIMIZATION_INPUT_LENGTH, MAX_CUSTOM_PROMPT_LENGTH } from '../../lib/constants';
import { enforceRateLimit, logApiError, serverError } from '../../lib/api-utils';
import { logAuditEvent } from '../../lib/audit-log';

// Only `spelling_grammar` is enabled — the other five presets are
// genuine LLM rewrites (tone/length/structure changes), and only
// `spelling_grammar`'s prompt has been stress-tested against the
// hardcoded EdenAI model (see hardcode-edenai-models/design.md's two
// revision rounds: 5 German/English texts, several rerun for stability).
// Deliberately temporary — re-enable a preset here (and in
// pages/textoptimierung.js's PRESETS array) once it's been verified with
// the same rigor, not before.
const ALLOWED_PRESETS = new Set([
  'spelling_grammar',
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
    preset = 'spelling_grammar',
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
    const trimmedCustomInstruction = typeof customInstruction === 'string' ? customInstruction.trim() : '';

    // Every preset (including spelling_grammar — see
    // hardcode-edenai-models) resolves the `chat` capability uniformly.
    // spelling_grammar used to route to a dedicated EdenAI grammar
    // feature; a real comparison found EdenAI's own chat capability with
    // this same narrow correction prompt corrects German text more
    // reliably, so it's just another chat preset now.
    const active = await resolveActiveProviderConfig({ userId, organizationId: orgId, capability: 'chat' });

    let providerModel;
    let callProvider;

    if (active.provider === 'edenai') {
      if (!active.apiKey) {
        return res.status(400).json({ message: 'Kein EdenAI-API-Key konfiguriert' });
      }
      providerModel = active.model;
      callProvider = (_reservation, budgetSignal) => optimizeTextEdenAi(
        text, preset, trimmedCustomInstruction, active.apiKey, active.model,
        { signal: composeAbortSignals(budgetSignal) },
      );
    } else {
      const preferredModel = resolveConfiguredModel(active, 'chat', requestModel || settingsRow?.preferred_model);
      if (!active.apiKey) {
        return res.status(400).json({ message: 'Kein OpenRouter-API-Key konfiguriert' });
      }
      if (!preferredModel) {
        return res.status(400).json({ message: 'Ungültiges KI-Modell' });
      }
      providerModel = preferredModel;
      callProvider = (_reservation, budgetSignal) => optimizeText(
        text, preset, trimmedCustomInstruction, active.apiKey, preferredModel,
        {
          baseUrl: active.baseUrl,
          fallbackModel: active.defaultModels.chat,
          organizationId: active.organizationId,
          signal: composeAbortSignals(budgetSignal),
        },
      );
    }

    const result = await executeReservedSpend(
      {
        idempotencyKey: requestBudgetScope(req, 'text-optimization', { text, preset, customInstruction, providerModel }),
        organizationId: orgId,
        userId,
        operation: 'text_optimization',
        provider: active.provider,
        model: providerModel,
        estimatedUsage: estimateTextUsage(text, {
          inputBufferTokens: 320,
          outputMultiplier: 1.1,
          outputBufferTokens: 192,
        }),
      },
      callProvider,
    );
    const optimizedText = result.optimizedText;

    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: 'text_optimization.completed',
      targetType: 'text_optimization',
      metadata: {
        preset,
        provider: active.provider,
        model: providerModel,
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
