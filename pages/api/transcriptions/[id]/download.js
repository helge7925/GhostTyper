import { readFile } from 'fs/promises';
import path from 'path';
import { query } from '../../../../lib/db';
import { enforceRateLimit, logApiError } from '../../../../lib/api-utils';
import { logAuditEvent } from '../../../../lib/audit-log';
import { withOrgScope } from '../../../../lib/api/with-org-scope';

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

function isSafeUploadPath(filePath) {
  if (!filePath) return false;
  const resolved = path.resolve(filePath);
  return resolved.startsWith(`${UPLOADS_DIR}${path.sep}`);
}

function safeDownloadName(filename) {
  return String(filename || 'download')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'download';
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'transcription-download',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    const { id } = req.query;
    const result = await query(
      `SELECT id, file_path, original_name, mime_type
       FROM transcriptions
       WHERE id = $1 AND organization_id = $2`,
      [id, orgId]
    );
    const row = result.rows[0];
    if (!row || !row.file_path) {
      return res.status(404).json({ message: 'Datei nicht gefunden' });
    }
    if (!isSafeUploadPath(row.file_path)) {
      return res.status(400).json({ message: 'Ungültiger Dateipfad' });
    }

    const buffer = await readFile(row.file_path);
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: 'download.file',
      targetType: 'transcription',
      targetId: String(row.id),
      metadata: {
        mimeType: row.mime_type || null,
        originalName: row.original_name || null,
      },
    });

    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeDownloadName(row.original_name)}"`);
    res.setHeader('Content-Length', String(buffer.length));
    return res.status(200).send(buffer);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return res.status(404).json({ message: 'Datei nicht gefunden' });
    }
    logApiError('Transcription download error', error);
    return res.status(500).json({ message: 'Download fehlgeschlagen' });
  }
}

export default withOrgScope({ permission: 'transcription.read' }, handler);
