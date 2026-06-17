import { translateText } from '../../lib/ai-service';
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
import { resolveChatModel } from '../../lib/model-policy';
import { getSettingsRow, resolveCortecsConfig } from '../../lib/settings-service';
import { MAX_TRANSLATE_INPUT_LENGTH } from '../../lib/constants';
import { enforceRateLimit, logApiError, serverError } from '../../lib/api-utils';
import { logAuditEvent } from '../../lib/audit-log';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'translate',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const { text, targetLanguage, sourceLanguage = 'auto', model: requestModel } = req.body;

  if (!text || !targetLanguage || typeof text !== 'string') {
    return res.status(400).json({ message: 'Text und Zielsprache sind erforderlich' });
  }
  if (text.length > MAX_TRANSLATE_INPUT_LENGTH) {
    return res.status(400).json({ message: `Text ist zu lang (max. ${MAX_TRANSLATE_INPUT_LENGTH} Zeichen)` });
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

    const translatedText = await withUserCostLock(userId, async () => {
      const costCheck = await checkCostLimit(userId, orgId);
      if (!costCheck.allowed) {
        throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
      }
      const estimatedCost = estimateTextTransformCost(preferredModel, text, {
        inputBufferTokens: 90,
        outputMultiplier: 1.1,
        outputBufferTokens: 90,
      });
      await enforceProjectedBudgetGuardrail(userId, estimatedCost, orgId);

      const { translatedText: value, usage, model } = await translateText(
        text,
        targetLanguage,
        sourceLanguage,
        apiKey,
        preferredModel,
        { baseUrl: cortecs.baseUrl, preference: cortecs.preference }
      );

      await logUsage(userId, model, 'translation', usage, orgId);
      return value;
    });

    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: 'translation.completed',
      targetType: 'translation',
      metadata: {
        targetLanguage,
        sourceLanguage,
        model: preferredModel,
        inputChars: text.length,
      },
    });

    return res.status(200).json({ translatedText });
  } catch (error) {
    if (error?.code === 'COST_LIMIT_EXCEEDED' || error?.code === 'BUDGET_GUARDRAIL_EXCEEDED') {
      return res.status(429).json({ message: error.message });
    }
    if (error instanceof CostLimitCheckUnavailableError || error?.code === 'COST_CHECK_UNAVAILABLE') {
      return res.status(503).json({ message: error.message });
    }
    logApiError('Translation error', error);
    return serverError(res, 'Fehler bei der Übersetzung');
  }
}

export default withOrgScope(handler);
