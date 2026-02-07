import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { query } from '../../lib/db';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  switch (req.method) {
    case 'GET': {
      const result = await query(
        'SELECT mistral_api_key, default_template, language FROM settings WHERE user_id = $1',
        [session.user.id]
      );

      if (result.rows.length === 0) {
        return res.status(200).json({
          apiKeyConfigured: false,
          defaultTemplate: 'meeting',
          language: 'de',
        });
      }

      const settings = result.rows[0];
      return res.status(200).json({
        apiKeyConfigured: !!settings.mistral_api_key,
        defaultTemplate: settings.default_template,
        language: settings.language,
      });
    }

    case 'PUT': {
      const { mistralApiKey, defaultTemplate, language } = req.body;

      await query(
        `INSERT INTO settings (user_id, mistral_api_key, default_template, language, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           mistral_api_key = COALESCE($2, settings.mistral_api_key),
           default_template = COALESCE($3, settings.default_template),
           language = COALESCE($4, settings.language),
           updated_at = NOW()`,
        [session.user.id, mistralApiKey || null, defaultTemplate || null, language || null]
      );

      return res.status(200).json({ message: 'Einstellungen gespeichert' });
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
