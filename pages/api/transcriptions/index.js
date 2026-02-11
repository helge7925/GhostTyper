import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';
import { logApiError, serverError } from '../../../lib/api-utils';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  switch (req.method) {
    case 'GET': {
      try {
        // Recover stale background jobs that were interrupted by process restarts.
        await query(
          `UPDATE transcriptions
           SET status = 'error',
               error = 'Verarbeitung wurde unterbrochen. Bitte erneut starten.',
               updated_at = NOW()
           WHERE user_id = $1
             AND status IN ('processing', 'analyzing')
             AND updated_at < NOW() - INTERVAL '45 minutes'`,
          [session.user.id]
        );

        const result = await query(
          `SELECT id, original_name, status, template, mime_type, folder_id, is_favorite, created_at, updated_at
           FROM transcriptions
           WHERE user_id = $1
           ORDER BY is_favorite DESC, created_at DESC`,
          [session.user.id]
        );
        return res.status(200).json(result.rows);
      } catch (error) {
        logApiError('Transcriptions list error', error);
        return serverError(res, 'Fehler beim Laden der Historie');
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
