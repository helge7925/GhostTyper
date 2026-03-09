import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { recoverStaleTranscriptionsForUser } from '../../../lib/transcription-stale';
import { ensureTranscriptionWorkerRunning } from '../../../lib/transcription-worker';
import { parseTranscriptionsListParams } from '../../../lib/transcriptions-list';

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

        const { search, scope, limit, offset } = parseTranscriptionsListParams(req.query || {});
        const useFullSearch = scope === 'full' && search.length >= 3;

        let sql = `SELECT id, original_name, status, template, mime_type, folder_id, is_favorite, created_at, updated_at
                   FROM transcriptions
                   WHERE user_id = $1`;
        const params = [session.user.id];

        if (search) {
          const searchPattern = `%${search}%`;
          params.push(searchPattern);
          const searchParamIdx = params.length;
          if (useFullSearch) {
            sql += ` AND (original_name ILIKE $${searchParamIdx} OR text ILIKE $${searchParamIdx} OR analysis::text ILIKE $${searchParamIdx})`;
          } else {
            sql += ` AND original_name ILIKE $${searchParamIdx}`;
          }
        }

        params.push(limit);
        const limitParamIdx = params.length;
        params.push(offset);
        const offsetParamIdx = params.length;

        sql += ` ORDER BY is_favorite DESC, created_at DESC LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`;

        const result = await query(sql, params);
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
