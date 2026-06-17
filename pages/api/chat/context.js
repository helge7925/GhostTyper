import { query } from '../../../lib/db';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { logAuditEvent } from '../../../lib/audit-log';
import { hasPermission } from '../../../lib/permissions';

async function conversationExists(conversationId, orgId, userId) {
  const result = await query(
    'SELECT id FROM chat_conversations WHERE id = $1 AND organization_id = $2 AND user_id = $3',
    [conversationId, orgId, userId],
  );
  return result.rowCount > 0;
}

async function listContextItems(conversationId, orgId) {
  const result = await query(
    `SELECT ci.id, ci.document_id, d.title, d.source_type, d.transcription_id
       FROM chat_context_items ci
       JOIN documents d
         ON d.id = ci.document_id
        AND d.organization_id = ci.organization_id
      WHERE ci.conversation_id = $1
        AND ci.organization_id = $2
      ORDER BY ci.created_at ASC`,
    [conversationId, orgId],
  );
  return result.rows;
}

async function handler(req, res) {
  const orgId = req.org.id;
  const userId = req.userId;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'chat-context',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  if (req.method === 'GET') {
    const conversationId = Number(req.query.conversationId);
    if (!Number.isFinite(conversationId)) {
      return res.status(400).json({ message: 'Ungültige Chat-ID' });
    }
    try {
      if (!(await conversationExists(conversationId, orgId, userId))) {
        return res.status(404).json({ message: 'Chat nicht gefunden' });
      }
      const items = await listContextItems(conversationId, orgId);
      return res.status(200).json({ items });
    } catch (error) {
      logApiError('Chat context GET failed', error);
      return serverError(res, 'Kontext konnte nicht geladen werden.');
    }
  }

  if (req.method === 'POST') {
    if (!hasPermission(req.role, 'chat.write')) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
    }
    const { conversationId, documentId } = req.body && typeof req.body === 'object' ? req.body : {};
    const convId = Number(conversationId);
    const docId = Number(documentId);
    if (!Number.isFinite(convId) || !Number.isFinite(docId)) {
      return res.status(400).json({ message: 'Chat-ID und Dokument-ID sind erforderlich' });
    }
    try {
      if (!(await conversationExists(convId, orgId, userId))) {
        return res.status(404).json({ message: 'Chat nicht gefunden' });
      }
      // Only allow attaching documents the user may actually read.
      const doc = await query(
        `SELECT id FROM documents
          WHERE id = $1 AND organization_id = $2
            AND (visibility = 'workspace' OR owner_user_id = $3)`,
        [docId, orgId, userId],
      );
      if (doc.rowCount === 0) {
        return res.status(404).json({ message: 'Dokument nicht gefunden' });
      }

      await query(
        `INSERT INTO chat_context_items (conversation_id, organization_id, document_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (conversation_id, document_id) DO NOTHING`,
        [convId, orgId, docId],
      );

      await logAuditEvent({
        userId,
        organizationId: orgId,
        action: 'chat.context.added',
        targetType: 'chat_conversation',
        targetId: String(convId),
        metadata: { documentId: docId },
      });

      const items = await listContextItems(convId, orgId);
      return res.status(200).json({ items });
    } catch (error) {
      logApiError('Chat context POST failed', error);
      return serverError(res, 'Kontext konnte nicht hinzugefügt werden.');
    }
  }

  if (req.method === 'DELETE') {
    if (!hasPermission(req.role, 'chat.write')) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
    }
    const convId = Number(req.query.conversationId);
    const docId = Number(req.query.documentId);
    if (!Number.isFinite(convId) || !Number.isFinite(docId)) {
      return res.status(400).json({ message: 'Chat-ID und Dokument-ID sind erforderlich' });
    }
    try {
      if (!(await conversationExists(convId, orgId, userId))) {
        return res.status(404).json({ message: 'Chat nicht gefunden' });
      }
      await query(
        'DELETE FROM chat_context_items WHERE conversation_id = $1 AND organization_id = $2 AND document_id = $3',
        [convId, orgId, docId],
      );
      await logAuditEvent({
        userId,
        organizationId: orgId,
        action: 'chat.context.removed',
        targetType: 'chat_conversation',
        targetId: String(convId),
        metadata: { documentId: docId },
      });
      const items = await listContextItems(convId, orgId);
      return res.status(200).json({ items });
    } catch (error) {
      logApiError('Chat context DELETE failed', error);
      return serverError(res, 'Kontext konnte nicht entfernt werden.');
    }
  }

  res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
  return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
}

export default withOrgScope({ permission: 'chat.read' }, handler);
