import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { recoverStaleTranscriptionsForUser } from '../../../lib/transcription-stale';
import { ensureTranscriptionWorkerRunning } from '../../../lib/transcription-worker';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'transcriptions-list',
    identifier: `user:${session.user.id}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'GET': {
      try {
        ensureTranscriptionWorkerRunning();
        await recoverStaleTranscriptionsForUser(session.user.id);

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
