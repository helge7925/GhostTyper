import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const userId = session.user.id;

  switch (req.method) {
    case 'GET': {
      try {
        const result = await query(
          'SELECT * FROM templates WHERE user_id = $1 ORDER BY name ASC',
          [userId]
        );
        return res.status(200).json(result.rows);
      } catch (error) {
        console.error('Error fetching templates:', error);
        return res.status(500).json({ message: 'Fehler beim Laden der Vorlagen' });
      }
    }

    case 'POST': {
      const { name, prompt_text } = req.body;
      if (!name || !prompt_text) {
        return res.status(400).json({ message: 'Name und Prompt-Text sind erforderlich' });
      }

      try {
        const result = await query(
          'INSERT INTO templates (user_id, name, prompt_text) VALUES ($1, $2, $3) RETURNING *',
          [userId, name, prompt_text]
        );
        return res.status(201).json(result.rows[0]);
      } catch (error) {
        console.error('Error creating template:', error);
        return res.status(500).json({ message: 'Fehler beim Erstellen der Vorlage' });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
