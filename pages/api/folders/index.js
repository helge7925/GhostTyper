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
          'SELECT * FROM folders WHERE user_id = $1 ORDER BY name ASC',
          [userId]
        );
        return res.status(200).json(result.rows);
      } catch (error) {
        console.error('Error fetching folders:', error);
        return res.status(500).json({ message: 'Fehler beim Laden der Ordner' });
      }
    }

    case 'POST': {
      const { name } = req.body;
      if (!name) {
        return res.status(400).json({ message: 'Ordnername ist erforderlich' });
      }

      try {
        const result = await query(
          'INSERT INTO folders (user_id, name) VALUES ($1, $2) RETURNING *',
          [userId, name]
        );
        return res.status(201).json(result.rows[0]);
      } catch (error) {
        console.error('Error creating folder:', error);
        return res.status(500).json({ message: 'Fehler beim Erstellen des Ordners' });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
