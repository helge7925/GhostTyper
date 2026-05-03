import { query } from '../../../lib/db';
import {
  MAX_DOCUMENT_HTML_LENGTH,
  MAX_DOCUMENT_TEXT_LENGTH,
  MAX_DOCUMENT_TITLE_LENGTH,
} from '../../../lib/constants';
import { enforceRateLimit, logApiError } from '../../../lib/api-utils';
import { logAuditEvent } from '../../../lib/audit-log';
import { withOrgScope } from '../../../lib/api/with-org-scope';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'transcription-save-doc',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const { title, text, documentHtml, template } = body;

  if (typeof title !== 'string' || typeof documentHtml !== 'string') {
    return res.status(400).json({ message: 'Titel und Inhalt sind erforderlich' });
  }
  if (!title.trim() || !documentHtml.trim()) {
    return res.status(400).json({ message: 'Titel und Inhalt sind erforderlich' });
  }
  if (title.length > MAX_DOCUMENT_TITLE_LENGTH) {
    return res.status(400).json({ message: `Titel ist zu lang (max. ${MAX_DOCUMENT_TITLE_LENGTH} Zeichen)` });
  }
  if (typeof text === 'string' && text.length > MAX_DOCUMENT_TEXT_LENGTH) {
    return res.status(400).json({ message: `Text ist zu lang (max. ${MAX_DOCUMENT_TEXT_LENGTH} Zeichen)` });
  }
  if (documentHtml.length > MAX_DOCUMENT_HTML_LENGTH) {
    return res.status(400).json({ message: `Dokument ist zu groß (max. ${MAX_DOCUMENT_HTML_LENGTH} Zeichen)` });
  }
  if (template !== undefined && typeof template !== 'string') {
    return res.status(400).json({ message: 'Ungültiges Template-Format' });
  }

  try {
    const result = await query(
      `INSERT INTO transcriptions (
        user_id, organization_id, filename, original_name, file_path, file_size,
        mime_type, status, template, text, document_html
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, $9, $10)
       RETURNING id`,
      [
        userId,
        orgId,
        'doc_' + Date.now(),
        title.trim(),
        'INTERNAL_DOC', // Placeholder for file_path
        0,
        'application/vnd.ghosttyper.doc',
        template || 'generic',
        typeof text === 'string' ? text : '',
        documentHtml,
      ]
    );

    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: 'document.saved',
      targetType: 'transcription',
      targetId: String(result.rows[0].id),
      metadata: {
        template: template || 'generic',
        title: title.trim(),
      },
    });

    return res.status(201).json({ id: result.rows[0].id, message: 'Dokument gespeichert' });
  } catch (error) {
    logApiError('Save doc error', error);
    return res.status(500).json({ message: 'Fehler beim Speichern des Dokuments' });
  }
}

export default withOrgScope({ permission: 'transcription.write' }, handler);
