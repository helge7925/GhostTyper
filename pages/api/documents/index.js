import { query } from '../../../lib/db';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { parseTranscriptionsListParams } from '../../../lib/transcriptions-list';

const ALLOWED_VISIBILITY = new Set(['private', 'workspace']);
const ALLOWED_SOURCE_TYPES = new Set([
  'audio_transcription',
  'meeting',
  'ocr',
  'translation',
  'data_table',
  'text',
  'workspace_file',
]);

function pickFirst(value) {
  return Array.isArray(value) ? value[0] : value;
}

async function handler(req, res) {
  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'documents-list',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { search, scope, limit, offset } = parseTranscriptionsListParams(req.query || {});
    const visibility = String(pickFirst(req.query?.visibility) || '').trim();
    const sourceType = String(pickFirst(req.query?.sourceType) || '').trim();
    const favorite = String(pickFirst(req.query?.favorite) || '').trim().toLowerCase();
    const useFullSearch = scope === 'full' && search.length >= 3;

    const params = [orgId, userId];
    let sql = `SELECT
                 d.id,
                 d.transcription_id,
                 d.title,
                 d.source_type,
                 d.visibility,
                 d.owner_user_id,
                 COALESCE(t.status, d.status) AS status,
                 COALESCE(t.mime_type, d.mime_type) AS mime_type,
                 d.file_size,
                 d.folder_id,
                 d.is_favorite,
                 d.tags,
                 d.summary,
                 d.text_preview,
                 COALESCE(chunk_stats.chunk_count, 0) AS chunk_count,
                 latest_job.status AS index_job_status,
                 latest_job.error AS index_job_error,
                 latest_job.created_at AS index_job_created_at,
                 latest_job.started_at AS index_job_started_at,
                 latest_job.finished_at AS index_job_finished_at,
                 d.created_at,
                 GREATEST(d.updated_at, COALESCE(t.updated_at, d.updated_at)) AS updated_at,
                 t.original_name,
                 t.filename,
                 t.template
               FROM documents d
                LEFT JOIN transcriptions t
                  ON t.id = d.transcription_id
                 AND t.organization_id = d.organization_id
                LEFT JOIN LATERAL (
                  SELECT COUNT(*)::int AS chunk_count
                    FROM document_chunks c
                   WHERE c.document_id = d.id
                     AND c.organization_id = d.organization_id
                ) chunk_stats ON true
                LEFT JOIN LATERAL (
                  SELECT status, error, created_at, started_at, finished_at
                    FROM document_index_jobs j
                   WHERE j.document_id = d.id
                   ORDER BY j.created_at DESC
                   LIMIT 1
                ) latest_job ON true
               WHERE d.organization_id = $1
                 AND (d.visibility = 'workspace' OR d.owner_user_id = $2)`;

    if (ALLOWED_VISIBILITY.has(visibility)) {
      params.push(visibility);
      sql += ` AND d.visibility = $${params.length}`;
    }

    if (ALLOWED_SOURCE_TYPES.has(sourceType)) {
      params.push(sourceType);
      sql += ` AND d.source_type = $${params.length}`;
    }

    if (favorite === 'true') {
      sql += ' AND d.is_favorite = true';
    }

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      if (useFullSearch) {
        sql += ` AND (d.title ILIKE $${idx} OR d.text_preview ILIKE $${idx} OR t.text ILIKE $${idx} OR t.analysis::text ILIKE $${idx})`;
      } else {
        sql += ` AND d.title ILIKE $${idx}`;
      }
    }

    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;
    sql += ` ORDER BY d.is_favorite DESC, updated_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

    const result = await query(sql, params);
    return res.status(200).json(result.rows);
  } catch (error) {
    logApiError('Documents list error', error);
    return serverError(res, 'Fehler beim Laden der Dateien');
  }
}

export default withOrgScope({ permission: 'document.read' }, handler);
