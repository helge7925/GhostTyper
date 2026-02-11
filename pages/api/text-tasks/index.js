import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';
import { TEXT_AI_PROMPTS } from '../../../lib/prompts';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const userId = session.user.id;

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
        console.error('Error fetching text tasks:', error);
        return res.status(500).json({ message: 'Fehler beim Laden der Aufgaben' });
      }
    }

    case 'POST': {
      const { name, prompt, is_favorite, position } = req.body;
      if (!name || !prompt) {
        return res.status(400).json({ message: 'Name und Prompt sind erforderlich' });
      }

      try {
        const result = await query(
          'INSERT INTO text_tasks (user_id, name, prompt, is_favorite, position) VALUES ($1, $2, $3, $4, $5) RETURNING *',
          [userId, name, prompt, !!is_favorite, position || 0]
        );
        return res.status(201).json(result.rows[0]);
      } catch (error) {
        console.error('Error creating text task:', error);
        return res.status(500).json({ message: 'Fehler beim Erstellen der Aufgabe' });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
