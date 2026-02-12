import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';
import { MAX_TEXT_TASK_NAME_LENGTH, MAX_TEXT_TASK_PROMPT_LENGTH } from '../../../lib/constants';
import { TEXT_AI_PROMPTS } from '../../../lib/prompts';
import { enforceRateLimit, logApiError } from '../../../lib/api-utils';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const userId = session.user.id;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'text-tasks',
    identifier: `user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'GET': {
      try {
        let result = await query(
          'SELECT * FROM text_tasks WHERE user_id = $1 ORDER BY is_favorite DESC, position ASC, name ASC',
          [userId]
        );

        // Seed default tasks if none exist for this user
        if (result.rows.length === 0) {
          for (const [key, data] of Object.entries(TEXT_AI_PROMPTS)) {
            await query(
              'INSERT INTO text_tasks (user_id, name, prompt, is_favorite) VALUES ($1, $2, $3, $4)',
              [userId, data.name, data.prompt, ['correction', 'rewrite', 'todos'].includes(key)]
            );
          }
          result = await query(
            'SELECT * FROM text_tasks WHERE user_id = $1 ORDER BY is_favorite DESC, position ASC, name ASC',
            [userId]
          );
        }

        return res.status(200).json(result.rows);
      } catch (error) {
        logApiError('Error fetching text tasks', error);
        return res.status(500).json({ message: 'Fehler beim Laden der Aufgaben' });
      }
    }

    case 'POST': {
      const { name, prompt, is_favorite, position } = req.body;
      if (!name || !prompt || typeof name !== 'string' || typeof prompt !== 'string') {
        return res.status(400).json({ message: 'Name und Prompt sind erforderlich' });
      }
      const normalizedName = name.trim();
      const normalizedPrompt = prompt.trim();
      if (!normalizedName || !normalizedPrompt) {
        return res.status(400).json({ message: 'Name und Prompt sind erforderlich' });
      }
      if (normalizedName.length > MAX_TEXT_TASK_NAME_LENGTH) {
        return res.status(400).json({ message: `Aufgabenname ist zu lang (max. ${MAX_TEXT_TASK_NAME_LENGTH} Zeichen)` });
      }
      if (normalizedPrompt.length > MAX_TEXT_TASK_PROMPT_LENGTH) {
        return res.status(400).json({ message: `Prompt ist zu lang (max. ${MAX_TEXT_TASK_PROMPT_LENGTH} Zeichen)` });
      }

      try {
        const result = await query(
          'INSERT INTO text_tasks (user_id, name, prompt, is_favorite, position) VALUES ($1, $2, $3, $4, $5) RETURNING *',
          [userId, normalizedName, normalizedPrompt, !!is_favorite, position || 0]
        );
        return res.status(201).json(result.rows[0]);
      } catch (error) {
        logApiError('Error creating text task', error);
        return res.status(500).json({ message: 'Fehler beim Erstellen der Aufgabe' });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
