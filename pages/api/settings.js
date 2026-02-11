import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { query } from '../../lib/db';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  try {
    switch (req.method) {
      case 'GET': {
        const result = await query(
          'SELECT mistral_api_key, default_template, language, context_bias, preferred_model, cost_limit, default_translate_language, ocr_model FROM settings WHERE user_id = $1',
          [session.user.id]
        );

        if (result.rows.length === 0) {
          return res.status(200).json({
            apiKeyConfigured: false,
            defaultTemplate: 'meeting',
            language: 'de',
            contextBias: '',
            preferredModel: 'mistral-large-latest',
            defaultTranslateLanguage: 'en',
            ocrModel: 'mistral-ocr-latest',
            costLimit: null,
          });
        }

        const settings = result.rows[0];
        return res.status(200).json({
          apiKeyConfigured: !!settings.mistral_api_key,
          defaultTemplate: settings.default_template,
          language: settings.language,
          contextBias: settings.context_bias || '',
          preferredModel: settings.preferred_model || 'mistral-large-latest',
          defaultTranslateLanguage: settings.default_translate_language || 'en',
          ocrModel: settings.ocr_model || 'mistral-ocr-latest',
          costLimit: settings.cost_limit,
        });
      }

      case 'PUT': {
        const { mistralApiKey, defaultTemplate, language, contextBias, preferredModel, costLimit, defaultTranslateLanguage, ocrModel } = req.body;

        await query(
          `INSERT INTO settings (user_id, mistral_api_key, default_template, language, context_bias, preferred_model, cost_limit, default_translate_language, ocr_model, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
           ON CONFLICT (user_id) DO UPDATE SET
             mistral_api_key = COALESCE($2, settings.mistral_api_key),
             default_template = COALESCE($3, settings.default_template),
             language = COALESCE($4, settings.language),
             context_bias = $5,
             preferred_model = COALESCE($6, settings.preferred_model),
             cost_limit = $7,
             default_translate_language = COALESCE($8, settings.default_translate_language),
             ocr_model = COALESCE($9, settings.ocr_model),
             updated_at = NOW()`,
          [
            session.user.id, 
            mistralApiKey || null, 
            defaultTemplate || null, 
            language || null, 
            contextBias ?? null, 
            preferredModel || null, 
            costLimit !== undefined ? costLimit : null,
            defaultTranslateLanguage || null,
            ocrModel || null
          ]
        );

        return res.status(200).json({ message: 'Einstellungen gespeichert' });
      }

      default:
        return res.status(405).json({ message: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Settings API error:', error);
    return res.status(500).json({ message: 'Fehler beim Verarbeiten der Einstellungen' });
  }
}
