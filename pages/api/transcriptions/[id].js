import { unlink } from 'fs/promises';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';

export default async function handler(req, res) {
  const { id } = req.query;

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  switch (req.method) {
    case 'GET': {
      const result = await query(
        `SELECT id, original_name, filename, status, template, text, analysis, error, created_at, updated_at
         FROM transcriptions
         WHERE id = $1 AND user_id = $2`,
        [id, session.user.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'Transkription nicht gefunden' });
      }

      return res.status(200).json(result.rows[0]);
    }

    case 'DELETE': {
      const existing = await query(
        'SELECT file_path FROM transcriptions WHERE id = $1 AND user_id = $2',
        [id, session.user.id]
      );

      if (existing.rows.length === 0) {
        return res.status(404).json({ message: 'Transkription nicht gefunden' });
      }

      try {
        await unlink(existing.rows[0].file_path);
      } catch {
        // File may already be deleted
      }

      await query('DELETE FROM transcriptions WHERE id = $1 AND user_id = $2', [id, session.user.id]);

      return res.status(200).json({ message: 'Transkription gelöscht' });
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
