import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { translateText } from '../../lib/ai-service';
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
import { getSettingsRow, resolveStoredApiKey } from '../../lib/settings-service';
import { MAX_TRANSLATE_INPUT_LENGTH } from '../../lib/constants';
import { enforceRateLimit, logApiError, serverError } from '../../lib/api-utils';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'translate',
    identifier: `user:${session.user.id}`,
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
    const settingsRow = await getSettingsRow(session.user.id);
    const apiKey = resolveStoredApiKey(settingsRow) || process.env.MISTRAL_API_KEY;
    const preferredModel = resolveChatModel(requestModel || settingsRow?.preferred_model || 'mistral-large-latest');

    if (!apiKey) {
      return res.status(400).json({ message: 'Kein Mistral API-Key konfiguriert' });
    }
    if (!preferredModel) {
      return res.status(400).json({ message: 'Ungültiges KI-Modell' });
    }

    const translatedText = await withUserCostLock(session.user.id, async () => {
      const costCheck = await checkCostLimit(session.user.id);
      if (!costCheck.allowed) {
        throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
      }
      const estimatedCost = estimateTextTransformCost(preferredModel, text, {
        inputBufferTokens: 90,
        outputMultiplier: 1.1,
        outputBufferTokens: 90,
      });
      await enforceProjectedBudgetGuardrail(session.user.id, estimatedCost);

      const { translatedText: value, usage, model } = await translateText(
        text,
        targetLanguage,
        sourceLanguage,
        apiKey,
        preferredModel
      );

      await logUsage(session.user.id, model, 'translation', usage);
      return value;
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
