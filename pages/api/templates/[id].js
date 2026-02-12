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
  const { id } = req.query;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'templates-item',
    identifier: `user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'PUT': {
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
          'UPDATE templates SET name = $1, prompt_text = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND user_id = $4 RETURNING *',
          [normalizedName, normalizedPrompt, id, userId]
        );

        if (result.rowCount === 0) {
          return res.status(404).json({ message: 'Vorlage nicht gefunden' });
        }

        return res.status(200).json(result.rows[0]);
      } catch (error) {
        logApiError('Error updating template', error);
        return res.status(500).json({ message: 'Fehler beim Aktualisieren der Vorlage' });
      }
    }

    case 'DELETE': {
      try {
        const result = await query(
          'DELETE FROM templates WHERE id = $1 AND user_id = $2',
          [id, userId]
        );

        if (result.rowCount === 0) {
          return res.status(404).json({ message: 'Vorlage nicht gefunden' });
        }

        return res.status(200).json({ message: 'Vorlage gelöscht' });
      } catch (error) {
        logApiError('Error deleting template', error);
        return res.status(500).json({ message: 'Fehler beim Löschen der Vorlage' });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
