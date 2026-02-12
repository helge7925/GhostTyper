import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';
import { MAX_FOLDER_NAME_LENGTH } from '../../../lib/constants';
import { enforceRateLimit, logApiError } from '../../../lib/api-utils';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const { id } = req.query;
  const userId = session.user.id;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'folders-item',
    identifier: `user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'PUT': {
      const { name } = req.body;
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ message: 'Ordnername ist erforderlich' });
      }
      const normalizedName = name.trim();
      if (!normalizedName) {
        return res.status(400).json({ message: 'Ordnername ist erforderlich' });
      }
      if (normalizedName.length > MAX_FOLDER_NAME_LENGTH) {
        return res.status(400).json({ message: `Ordnername ist zu lang (max. ${MAX_FOLDER_NAME_LENGTH} Zeichen)` });
      }

      try {
        const result = await query(
          'UPDATE folders SET name = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING *',
          [normalizedName, id, userId]
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ message: 'Ordner nicht gefunden' });
        }
        return res.status(200).json(result.rows[0]);
      } catch (error) {
        logApiError('Error updating folder', error);
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
        logApiError('Error deleting folder', error);
        return res.status(500).json({ message: 'Fehler beim Löschen des Ordners' });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
