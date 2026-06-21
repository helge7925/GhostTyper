import path from 'path';
import { unlink } from 'fs/promises';
import { query } from '../../../lib/db';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { hasPermission } from '../../../lib/permissions';
import { logAuditEvent } from '../../../lib/audit-log';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const ALLOWED_VISIBILITY = new Set(['private', 'workspace']);

function isSafeUploadPath(filePath) {
  if (!filePath) return false;
  const resolved = path.resolve(filePath);
  return resolved.startsWith(path.resolve(UPLOADS_DIR) + path.sep);
}

function canWriteDocument(document, req) {
  if (!document) return false;
  if (Number(document.owner_user_id) === Number(req.userId)) return true;
  return hasPermission(req.role, 'document.write');
}

function canDeleteDocument(document, req) {
  if (!document) return false;
  if (Number(document.owner_user_id) === Number(req.userId)) return true;
  return hasPermission(req.role, 'document.delete');
}

async function loadDocument(documentId, orgId, userId) {
  const result = await query(
    `SELECT d.*, t.file_path, t.original_name, t.filename, t.template, t.text, t.analysis,
            COALESCE(chunk_stats.chunk_count, 0) AS chunk_count,
            latest_job.status AS index_job_status,
            latest_job.error AS index_job_error,
            latest_job.created_at AS index_job_created_at,
            latest_job.started_at AS index_job_started_at,
            latest_job.finished_at AS index_job_finished_at
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
      WHERE d.id = $1
        AND d.organization_id = $2
        AND (d.visibility = 'workspace' OR d.owner_user_id = $3)`,
    [documentId, orgId, userId],
  );
  return result.rows[0] || null;
}

async function handler(req, res) {
  const documentId = Number.parseInt(String(req.query.id || ''), 10);
  if (!Number.isFinite(documentId)) {
    return res.status(400).json({ message: 'Ungültige Datei-ID' });
  }

  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'documents-item',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'GET': {
      try {
        const document = await loadDocument(documentId, orgId, userId);
        if (!document) return res.status(404).json({ message: 'Datei nicht gefunden' });
        await logAuditEvent({
          userId: req.userId,
          organizationId: orgId,
          action: 'document.read',
          targetType: 'document',
          targetId: String(documentId),
          metadata: {
            sourceType: document.source_type,
            visibility: document.visibility,
          },
        });
        return res.status(200).json(document);
      } catch (error) {
        logApiError('Document GET error', error);
        return serverError(res, 'Fehler beim Laden der Datei');
      }
    }

    case 'PATCH': {
      try {
        const document = await loadDocument(documentId, orgId, userId);
        if (!document) return res.status(404).json({ message: 'Datei nicht gefunden' });
        if (!canWriteDocument(document, req)) {
          return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung zum Bearbeiten.' });
        }

        const { title, visibility, folderId, isFavorite, tags } = req.body && typeof req.body === 'object' ? req.body : {};
        const updates = [];
        const values = [];
        let idx = 1;

        if (title !== undefined) {
          const normalized = String(title || '').trim();
          if (!normalized) return res.status(400).json({ message: 'Titel ist erforderlich' });
          if (normalized.length > 255) return res.status(400).json({ message: 'Titel ist zu lang' });
          updates.push(`title = $${idx++}`);
          values.push(normalized);
        }

        if (visibility !== undefined) {
          if (!ALLOWED_VISIBILITY.has(visibility)) {
            return res.status(400).json({ message: 'Ungültige Sichtbarkeit' });
          }
          updates.push(`visibility = $${idx++}`);
          values.push(visibility);
        }

        if (folderId !== undefined) {
          if (folderId === null || folderId === '') {
            updates.push(`folder_id = $${idx++}`);
            values.push(null);
          } else {
            const folder = await query(
              `SELECT id FROM folders
                WHERE id = $1
                  AND organization_id = $2
                  AND (visibility = 'workspace' OR user_id = $3)`,
              [folderId, orgId, userId],
            );
            if (folder.rows.length === 0) return res.status(400).json({ message: 'Ungültiger Ordner' });
            updates.push(`folder_id = $${idx++}`);
            values.push(folderId);
          }
        }

        if (isFavorite !== undefined) {
          updates.push(`is_favorite = $${idx++}`);
          values.push(Boolean(isFavorite));
        }

        if (tags !== undefined) {
          if (!Array.isArray(tags)) return res.status(400).json({ message: 'Tags müssen eine Liste sein' });
          const normalizedTags = [...new Set(tags.map((tag) => String(tag || '').trim()).filter(Boolean))].slice(0, 30);
          updates.push(`tags = $${idx++}`);
          values.push(normalizedTags);
        }

        if (updates.length === 0) {
          return res.status(200).json({ message: 'Keine Änderungen' });
        }

        updates.push('updated_at = NOW()');
        values.push(documentId, orgId);
        const updated = await query(
          `UPDATE documents SET ${updates.join(', ')} WHERE id = $${idx++} AND organization_id = $${idx} RETURNING *`,
          values,
        );

        if (document.transcription_id && (folderId !== undefined || isFavorite !== undefined)) {
          const txUpdates = [];
          const txValues = [];
          let txIdx = 1;
          if (folderId !== undefined) {
            txUpdates.push(`folder_id = $${txIdx++}`);
            txValues.push(folderId === '' ? null : folderId);
          }
          if (isFavorite !== undefined) {
            txUpdates.push(`is_favorite = $${txIdx++}`);
            txValues.push(Boolean(isFavorite));
          }
          if (txUpdates.length > 0) {
            txValues.push(document.transcription_id, orgId);
            await query(
              `UPDATE transcriptions SET ${txUpdates.join(', ')}, updated_at = NOW() WHERE id = $${txIdx++} AND organization_id = $${txIdx}`,
              txValues,
            );
          }
        }

        await logAuditEvent({
          userId: req.userId,
          organizationId: orgId,
          action: 'document.update',
          targetType: 'document',
          targetId: String(documentId),
          metadata: {
            changes: {
              title: title !== undefined ? String(title) : undefined,
              visibility: visibility !== undefined ? visibility : undefined,
              folderId: folderId !== undefined ? folderId : undefined,
              isFavorite: isFavorite !== undefined ? isFavorite : undefined,
              tags: tags !== undefined ? normalizedTags : undefined,
            },
          },
        });

        return res.status(200).json(updated.rows[0]);
      } catch (error) {
        logApiError('Document PATCH error', error);
        return serverError(res, 'Fehler beim Speichern der Datei');
      }
    }

    case 'DELETE': {
      try {
        const document = await loadDocument(documentId, orgId, userId);
        if (!document) return res.status(404).json({ message: 'Datei nicht gefunden' });
        if (!canDeleteDocument(document, req)) {
          return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung zum Löschen.' });
        }

        await logAuditEvent({
          userId: req.userId,
          organizationId: orgId,
          action: 'document.delete',
          targetType: 'document',
          targetId: String(documentId),
          metadata: {
            transcriptionId: document.transcription_id,
            sourceType: document.source_type,
            filePath: document.file_path,
          },
        });

        if (document.transcription_id) {
          if (document.file_path && document.file_path !== 'INTERNAL_DOC' && isSafeUploadPath(document.file_path)) {
            await unlink(document.file_path).catch(() => {});
          }
          await query('DELETE FROM transcriptions WHERE id = $1 AND organization_id = $2', [document.transcription_id, orgId]);
        } else {
          await query('DELETE FROM documents WHERE id = $1 AND organization_id = $2', [documentId, orgId]);
        }

        return res.status(200).json({ message: 'Datei gelöscht' });
      } catch (error) {
        logApiError('Document DELETE error', error);
        return serverError(res, 'Fehler beim Löschen der Datei');
      }
    }

    default:
      res.setHeader('Allow', ['GET', 'PATCH', 'DELETE']);
      return res.status(405).json({ message: 'Method not allowed' });
  }
}

export default withOrgScope({ permission: 'document.read' }, handler);
