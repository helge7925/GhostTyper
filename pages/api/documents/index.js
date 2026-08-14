import { query } from '../../../lib/db';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { logAuditEvent } from '../../../lib/audit-log';
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
const ALLOWED_STATUS = new Set(['pending', 'queued', 'processing', 'transcribed', 'analyzing', 'completed', 'error', 'ready']);

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
    const status = String(pickFirst(req.query?.status) || '').trim();
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
                 d.created_at,
                 GREATEST(d.updated_at, COALESCE(t.updated_at, d.updated_at)) AS updated_at,
                 t.original_name,
                 t.filename,
                 t.template
               FROM documents d
                LEFT JOIN transcriptions t
                  ON t.id = d.transcription_id
                 AND t.organization_id = d.organization_id
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

    if (ALLOWED_STATUS.has(status)) {
      params.push(status);
      sql += ` AND COALESCE(t.status, d.status) = $${params.length}`;
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
    await logAuditEvent({
      userId: req.userId,
      organizationId: orgId,
      action: 'documents.list',
      targetType: 'documents',
      metadata: {
        filter: {
          visibility,
          sourceType,
          status,
          favorite,
          search,
        },
        resultCount: result.rows.length,
      },
    });
    return res.status(200).json(result.rows);
  } catch (error) {
    logApiError('Documents list error', error);
    return serverError(res, 'Fehler beim Laden der Dateien');
  }
}

export default withOrgScope({ permission: 'document.read' }, handler);
