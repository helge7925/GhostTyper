import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const { id } = req.query;
  const userId = session.user.id;

  switch (req.method) {
    case 'PUT': {
      const { name } = req.body;
      if (!name) {
        return res.status(400).json({ message: 'Ordnername ist erforderlich' });
      }

      try {
        const result = await query(
          'UPDATE folders SET name = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING *',
          [name, id, userId]
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ message: 'Ordner nicht gefunden' });
        }
        return res.status(200).json(result.rows[0]);
      } catch (error) {
        console.error('Error updating folder:', error);
        return res.status(500).json({ message: 'Fehler beim Aktualisieren des Ordners' });
      }
    }

    case 'DELETE': {
      try {
        const result = await query(
          'DELETE FROM folders WHERE id = $1 AND user_id = $2 RETURNING *',
          [id, userId]
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ message: 'Ordner nicht gefunden' });
        }
        return res.status(200).json({ message: 'Ordner gelöscht' });
      } catch (error) {
        console.error('Error deleting folder:', error);
        return res.status(500).json({ message: 'Fehler beim Löschen des Ordners' });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
