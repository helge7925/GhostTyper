import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { query } from '../../lib/db';
import { translateText } from '../../lib/ai-service';
import { logUsage, checkCostLimit } from '../../lib/usage';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const { text, targetLanguage, sourceLanguage = 'auto', model: requestModel } = req.body;

  if (!text || !targetLanguage) {
    return res.status(400).json({ message: 'Text und Zielsprache sind erforderlich' });
  }

  try {
    // Get user settings
    const settingsResult = await query(
      'SELECT mistral_api_key, preferred_model FROM settings WHERE user_id = $1',
      [session.user.id]
    );
    const apiKey = settingsResult.rows[0]?.mistral_api_key || process.env.MISTRAL_API_KEY;
    const preferredModel = requestModel || settingsResult.rows[0]?.preferred_model || 'mistral-large-latest';

    if (!apiKey) {
      return res.status(400).json({ message: 'Kein Mistral API-Key konfiguriert' });
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
    console.error('Translation error:', error);
    return res.status(500).json({ message: error.message || 'Fehler bei der Übersetzung' });
  }
}
