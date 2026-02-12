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

  const userId = session.user.id;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'folders',
    identifier: `user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'GET': {
      try {
        const result = await query(
          'SELECT * FROM folders WHERE user_id = $1 ORDER BY name ASC',
          [userId]
        );
        return res.status(200).json(result.rows);
      } catch (error) {
        logApiError('Error fetching folders', error);
        return res.status(500).json({ message: 'Fehler beim Laden der Ordner' });
      }
    }

    case 'POST': {
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
          'INSERT INTO folders (user_id, name) VALUES ($1, $2) RETURNING *',
          [userId, normalizedName]
        );
        return res.status(201).json(result.rows[0]);
      } catch (error) {
        logApiError('Error creating folder', error);
        return res.status(500).json({ message: 'Fehler beim Erstellen des Ordners' });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
