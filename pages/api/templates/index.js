import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';
import { MAX_TEMPLATE_NAME_LENGTH, MAX_TEXT_TASK_PROMPT_LENGTH } from '../../../lib/constants';
import { enforceRateLimit, logApiError } from '../../../lib/api-utils';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const userId = session.user.id;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'templates',
    identifier: `user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'GET': {
      try {
        const result = await query(
          'SELECT * FROM templates WHERE user_id = $1 ORDER BY name ASC',
          [userId]
        );
        return res.status(200).json(result.rows);
      } catch (error) {
        logApiError('Error fetching templates', error);
        return res.status(500).json({ message: 'Fehler beim Laden der Vorlagen' });
      }
    }

    case 'POST': {
      const { name, prompt_text } = req.body;
      if (!name || !prompt_text || typeof name !== 'string' || typeof prompt_text !== 'string') {
        return res.status(400).json({ message: 'Name und Prompt-Text sind erforderlich' });
      }
      const normalizedName = name.trim();
      const normalizedPrompt = prompt_text.trim();
      if (!normalizedName || !normalizedPrompt) {
        return res.status(400).json({ message: 'Name und Prompt-Text sind erforderlich' });
      }
      if (normalizedName.length > MAX_TEMPLATE_NAME_LENGTH) {
        return res.status(400).json({ message: `Vorlagenname ist zu lang (max. ${MAX_TEMPLATE_NAME_LENGTH} Zeichen)` });
      }
      if (normalizedPrompt.length > MAX_TEXT_TASK_PROMPT_LENGTH) {
        return res.status(400).json({ message: `Prompt ist zu lang (max. ${MAX_TEXT_TASK_PROMPT_LENGTH} Zeichen)` });
      }

      try {
        const result = await query(
          'INSERT INTO templates (user_id, name, prompt_text) VALUES ($1, $2, $3) RETURNING *',
          [userId, normalizedName, normalizedPrompt]
        );
        return res.status(201).json(result.rows[0]);
      } catch (error) {
        logApiError('Error creating template', error);
        return res.status(500).json({ message: 'Fehler beim Erstellen der Vorlage' });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
