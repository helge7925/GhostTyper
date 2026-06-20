import path from 'path';
import { unlink } from 'fs/promises';
import { query } from '../../../lib/db';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { hasPermission } from '../../../lib/permissions';
import { logAuditEvent } from '../../../lib/audit-log';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

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
    `SELECT d.*, t.file_path, t.original_name, t.filename, t.template, t.text, t.analysis
       FROM documents d
       LEFT JOIN transcriptions t
         ON t.id = d.transcription_id
        AND t.organization_id = d.organization_id
      WHERE d.id = $1
        AND d.organization_id = $2
        AND (d.visibility = 'workspace' OR d.owner_user_id = $3)`,
    [documentId, orgId, userId],
  );
  return result.rows[0] || null;
}

async function loadDocuments(documentIds, orgId, userId) {
  if (documentIds.length === 0) return [];
  const result = await query(
    `SELECT d.*, t.file_path, t.original_name, t.filename, t.template, t.text, t.analysis
       FROM documents d
       LEFT JOIN transcriptions t
         ON t.id = d.transcription_id
        AND t.organization_id = d.organization_id
      WHERE d.id = ANY($1::int[])
        AND d.organization_id = $2
        AND (d.visibility = 'workspace' OR d.owner_user_id = $3)`,
    [documentIds, orgId, userId],
  );
  return result.rows;
}

// Helper to validate folder exists and is accessible
async function validateFolder(folderId, orgId, userId) {
  if (folderId === null || folderId === '') return null;
  const result = await query(
    `SELECT id FROM folders
      WHERE id = $1
        AND organization_id = $2
        AND (visibility = 'workspace' OR user_id = $3)`,
    [folderId, orgId, userId],
  );
  return result.rows[0] || null;
}

async function handler(req, res) {
  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'documents-bulk',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { action, documentIds, folderId, tags, tagMode } = req.body || {};

  if (!Array.isArray(documentIds) || documentIds.length === 0) {
    return res.status(400).json({ message: 'documentIds must be a non-empty array' });
  }

  if (!['delete', 'move', 'tag'].includes(action)) {
    return res.status(400).json({ message: 'Invalid action. Must be delete, move, or tag.' });
  }

  try {
    const documents = await loadDocuments(documentIds, orgId, userId);
    const documentMap = new Map(documents.map((d) => [d.id, d]));

    // Check permissions for each document
    const authorizedIds = [];
    for (const id of documentIds) {
      const doc = documentMap.get(id);
      if (!doc) continue;

      if (action === 'delete' && !canDeleteDocument(doc, req)) continue;
      if (action === 'move' && !canWriteDocument(doc, req)) continue;
      if (action === 'tag' && !canWriteDocument(doc, req)) continue;

      authorizedIds.push(id);
    }

    if (authorizedIds.length === 0) {
      return res.status(403).json({ message: 'Keine Berechtigung für die ausgewählten Dateien.' });
    }

    // Log the bulk action
    await logAuditEvent({
      userId: req.userId,
      organizationId: orgId,
      action: `documents.bulk.${action}`,
      targetType: 'documents',
      metadata: {
        documentIds: authorizedIds,
        action,
        folderId: action === 'move' ? folderId : undefined,
        tags: action === 'tag' ? tags : undefined,
        tagMode: action === 'tag' ? tagMode : undefined,
        totalRequested: documentIds.length,
        totalAuthorized: authorizedIds.length,
      },
    });

    // Validate folder for move action
    if (action === 'move') {
      const folder = await validateFolder(folderId, orgId, userId);
      if (folderId !== null && folderId !== '' && !folder) {
        return res.status(400).json({ message: 'Ungültiger Ordner.' });
      }
    }

    // Validate tags for tag action
    if (action === 'tag') {
      if (!Array.isArray(tags)) {
        return res.status(400).json({ message: 'Tags müssen eine Liste sein.' });
      }
      const normalizedTags = [...new Set(tags.map((tag) => String(tag || '').trim()).filter(Boolean))].slice(0, 30);
      if (normalizedTags.length === 0 && tagMode !== 'remove') {
        return res.status(400).json({ message: 'Mindestens ein Tag erforderlich.' });
      }
    }

    // Execute the action
    const results = {
      success: [],
      failed: [],
    };

    for (const id of authorizedIds) {
      const doc = documentMap.get(id);
      try {
        if (action === 'delete') {
          if (doc.transcription_id) {
            if (doc.file_path && doc.file_path !== 'INTERNAL_DOC' && isSafeUploadPath(doc.file_path)) {
              await unlink(doc.file_path).catch(() => {});
            }
            await query('DELETE FROM transcriptions WHERE id = $1 AND organization_id = $2', [doc.transcription_id, orgId]);
          } else {
            await query('DELETE FROM documents WHERE id = $1 AND organization_id = $2', [id, orgId]);
          }
          results.success.push(id);
        } else if (action === 'move') {
          const targetFolderId = folderId === null || folderId === '' ? null : folderId;
          await query(
            `UPDATE documents SET folder_id = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3`,
            [targetFolderId, id, orgId],
          );
          // Also update transcription if it exists
          if (doc.transcription_id) {
            await query(
              `UPDATE transcriptions SET folder_id = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3`,
              [targetFolderId, doc.transcription_id, orgId],
            );
          }
          results.success.push(id);
        } else if (action === 'tag') {
          const normalizedTags = [...new Set(tags.map((tag) => String(tag || '').trim()).filter(Boolean))].slice(0, 30);
          if (tagMode === 'replace') {
            await query(
              `UPDATE documents SET tags = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3`,
              [normalizedTags, id, orgId],
            );
          } else if (tagMode === 'add') {
            // Merge existing tags with new ones
            const existingDoc = await query(
              `SELECT tags FROM documents WHERE id = $1 AND organization_id = $2`,
              [id, orgId],
            );
            const existingTags = Array.isArray(existingDoc.rows[0]?.tags) ? existingDoc.rows[0].tags : [];
            const mergedTags = [...new Set([...existingTags, ...normalizedTags])].slice(0, 30);
            await query(
              `UPDATE documents SET tags = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3`,
              [mergedTags, id, orgId],
            );
          } else if (tagMode === 'remove') {
            const existingDoc = await query(
              `SELECT tags FROM documents WHERE id = $1 AND organization_id = $2`,
              [id, orgId],
            );
            const existingTags = Array.isArray(existingDoc.rows[0]?.tags) ? existingDoc.rows[0].tags : [];
            const filteredTags = existingTags.filter((tag) => !normalizedTags.includes(tag));
            await query(
              `UPDATE documents SET tags = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3`,
              [filteredTags, id, orgId],
            );
          }
          results.success.push(id);
        }
      } catch (error) {
        results.failed.push({ id, error: error.message });
      }
    }

    return res.status(200).json({
      message: `${results.success.length} Dateien erfolgreich bearbeitet.`,
      success: results.success,
      failed: results.failed,
    });
  } catch (error) {
    logApiError('Documents bulk action error', error);
    return serverError(res, 'Fehler bei der Bulk-Aktion');
  }
}

export default withOrgScope({ permission: 'document.write' }, handler);
