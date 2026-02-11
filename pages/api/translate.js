import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { translateText } from '../../lib/ai-service';
import { logUsage, checkCostLimit } from '../../lib/usage';
import { resolveChatModel } from '../../lib/model-policy';
import { getSettingsRow, resolveStoredApiKey } from '../../lib/settings-service';
import { checkRateLimit, applyRateLimitHeaders } from '../../lib/rate-limit';
import { logApiError, serverError } from '../../lib/api-utils';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const rate = checkRateLimit(req, {
    keyPrefix: 'translate',
    identifier: `user:${session.user.id}`,
    limit: 60,
    windowMs: 60_000,
  });
  applyRateLimitHeaders(res, rate);
  if (!rate.allowed) {
    return res.status(429).json({ message: 'Zu viele Anfragen. Bitte später erneut versuchen.' });
  }

  const { text, targetLanguage, sourceLanguage = 'auto', model: requestModel } = req.body;

  if (!text || !targetLanguage) {
    return res.status(400).json({ message: 'Text und Zielsprache sind erforderlich' });
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

    // Check cost limit
    const costCheck = await checkCostLimit(session.user.id);
    if (!costCheck.allowed) {
      return res.status(429).json({
        message: `Monatliches Kostenlimit erreicht (${costCheck.currentCost.toFixed(2)} / ${costCheck.limit.toFixed(2)} EUR)`,
      });
    }

    const { translatedText, usage, model } = await translateText(
      text,
      targetLanguage,
      sourceLanguage,
      apiKey,
      preferredModel
    );

    // Log usage
    await logUsage(session.user.id, model, 'translation', usage);

    return res.status(200).json({ translatedText });
  } catch (error) {
    logApiError('Translation error', error);
    return serverError(res, 'Fehler bei der Übersetzung');
  }
}
