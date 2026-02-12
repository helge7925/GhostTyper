import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';
import { MAX_TEXT_TASK_NAME_LENGTH, MAX_TEXT_TASK_PROMPT_LENGTH } from '../../../lib/constants';
import { enforceRateLimit, logApiError } from '../../../lib/api-utils';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const { id } = req.query;
  const userId = session.user.id;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'text-tasks-item',
    identifier: `user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'PUT': {
      const { name, prompt, is_favorite, position } = req.body;
      if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ message: 'Name ist ungültig' });
        }
        if (name.trim().length > MAX_TEXT_TASK_NAME_LENGTH) {
          return res.status(400).json({ message: `Aufgabenname ist zu lang (max. ${MAX_TEXT_TASK_NAME_LENGTH} Zeichen)` });
        }
      }
      if (prompt !== undefined) {
        if (typeof prompt !== 'string' || !prompt.trim()) {
          return res.status(400).json({ message: 'Prompt ist ungültig' });
        }
        if (prompt.trim().length > MAX_TEXT_TASK_PROMPT_LENGTH) {
          return res.status(400).json({ message: `Prompt ist zu lang (max. ${MAX_TEXT_TASK_PROMPT_LENGTH} Zeichen)` });
        }
      }
      try {
        const result = await query(
          `UPDATE text_tasks 
           SET name = COALESCE($1, name), 
               prompt = COALESCE($2, prompt), 
               is_favorite = COALESCE($3, is_favorite), 
               position = COALESCE($4, position),
               updated_at = NOW() 
           WHERE id = $5 AND user_id = $6 RETURNING *`,
          [
            name !== undefined ? name.trim() : undefined,
            prompt !== undefined ? prompt.trim() : undefined,
            is_favorite,
            position,
            id,
            userId,
          ]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Aufgabe nicht gefunden' });
        return res.status(200).json(result.rows[0]);
      } catch (error) {
        logApiError('Text task update error', error);
        return res.status(500).json({ message: 'Fehler beim Aktualisieren' });
      }
    }

    case 'DELETE': {
      try {
        const result = await query('DELETE FROM text_tasks WHERE id = $1 AND user_id = $2 RETURNING *', [id, userId]);
        if (result.rows.length === 0) return res.status(404).json({ message: 'Aufgabe nicht gefunden' });
        return res.status(200).json({ message: 'Aufgabe gelöscht' });
      } catch (error) {
        logApiError('Text task delete error', error);
        return res.status(500).json({ message: 'Fehler beim Löschen' });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
