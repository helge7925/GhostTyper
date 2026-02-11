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
      const { name, prompt, is_favorite, position } = req.body;
      try {
        const result = await query(
          `UPDATE text_tasks 
           SET name = COALESCE($1, name), 
               prompt = COALESCE($2, prompt), 
               is_favorite = COALESCE($3, is_favorite), 
               position = COALESCE($4, position),
               updated_at = NOW() 
           WHERE id = $5 AND user_id = $6 RETURNING *`,
          [name, prompt, is_favorite, position, id, userId]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Aufgabe nicht gefunden' });
        return res.status(200).json(result.rows[0]);
      } catch (error) {
        return res.status(500).json({ message: 'Fehler beim Aktualisieren' });
      }
    }

    case 'DELETE': {
      try {
        const result = await query('DELETE FROM text_tasks WHERE id = $1 AND user_id = $2 RETURNING *', [id, userId]);
        if (result.rows.length === 0) return res.status(404).json({ message: 'Aufgabe nicht gefunden' });
        return res.status(200).json({ message: 'Aufgabe gelöscht' });
      } catch (error) {
        return res.status(500).json({ message: 'Fehler beim Löschen' });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
