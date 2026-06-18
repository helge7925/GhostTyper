import { query } from '../../../lib/db';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { logAuditEvent } from '../../../lib/audit-log';
import { hasPermission } from '../../../lib/permissions';
import { getKnowledgeBase } from '../../../lib/knowledge';

async function conversationExists(conversationId, orgId, userId) {
  const result = await query(
    'SELECT id FROM chat_conversations WHERE id = $1 AND organization_id = $2 AND user_id = $3',
    [conversationId, orgId, userId],
  );
  return result.rowCount > 0;
}

async function listContextItems(conversationId, orgId, userId) {
  const result = await query(
    `SELECT ci.id,
            ci.context_type,
            ci.document_id,
            ci.knowledge_base_id,
            CASE WHEN ci.context_type = 'knowledge_base' THEN kb.name ELSE d.title END AS title,
            d.source_type,
            d.transcription_id,
            kb.description AS knowledge_description
       FROM chat_context_items ci
       LEFT JOIN documents d
          ON d.id = ci.document_id
         AND d.organization_id = ci.organization_id
       LEFT JOIN knowledge_bases kb
         ON kb.id = ci.knowledge_base_id
        AND kb.organization_id = ci.organization_id
      WHERE ci.conversation_id = $1
        AND ci.organization_id = $2
        AND (
          (ci.context_type = 'document' AND d.id IS NOT NULL AND (d.visibility = 'workspace' OR d.owner_user_id = $3))
          OR (ci.context_type = 'knowledge_base' AND kb.id IS NOT NULL)
        )
      ORDER BY ci.created_at ASC`,
    [conversationId, orgId, userId],
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
      const items = await listContextItems(conversationId, orgId, userId);
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
    const { conversationId, documentId, knowledgeBaseId, contextType } = req.body && typeof req.body === 'object' ? req.body : {};
    const convId = Number(conversationId);
    const type = contextType === 'knowledge_base' || knowledgeBaseId != null ? 'knowledge_base' : 'document';
    const docId = Number(documentId);
    const kbId = Number(knowledgeBaseId);
    if (!Number.isFinite(convId) || (type === 'document' && !Number.isFinite(docId)) || (type === 'knowledge_base' && !Number.isFinite(kbId))) {
      return res.status(400).json({ message: 'Chat-ID und Kontext-ID sind erforderlich' });
    }
    try {
      if (!(await conversationExists(convId, orgId, userId))) {
        return res.status(404).json({ message: 'Chat nicht gefunden' });
      }

      if (type === 'knowledge_base') {
        const kb = await getKnowledgeBase(kbId, orgId);
        if (!kb) return res.status(404).json({ message: 'Wissensbasis nicht gefunden' });
        await query(
          `INSERT INTO chat_context_items (conversation_id, organization_id, context_type, knowledge_base_id)
           SELECT $1, $2, 'knowledge_base', $3
           WHERE NOT EXISTS (
             SELECT 1 FROM chat_context_items
              WHERE conversation_id = $1 AND organization_id = $2 AND context_type = 'knowledge_base' AND knowledge_base_id = $3
           )`,
          [convId, orgId, kbId],
        );
      } else {
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
          `INSERT INTO chat_context_items (conversation_id, organization_id, context_type, document_id)
           SELECT $1, $2, 'document', $3
           WHERE NOT EXISTS (
             SELECT 1 FROM chat_context_items
              WHERE conversation_id = $1 AND organization_id = $2 AND context_type = 'document' AND document_id = $3
           )`,
          [convId, orgId, docId],
        );
      }

      await logAuditEvent({
        userId,
        organizationId: orgId,
        action: 'chat.context.added',
        targetType: 'chat_conversation',
        targetId: String(convId),
        metadata: type === 'knowledge_base' ? { contextType: type, knowledgeBaseId: kbId } : { contextType: type, documentId: docId },
      });

      const items = await listContextItems(convId, orgId, userId);
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
    const kbId = Number(req.query.knowledgeBaseId);
    const type = req.query.contextType === 'knowledge_base' || Number.isFinite(kbId) ? 'knowledge_base' : 'document';
    if (!Number.isFinite(convId) || (type === 'document' && !Number.isFinite(docId)) || (type === 'knowledge_base' && !Number.isFinite(kbId))) {
      return res.status(400).json({ message: 'Chat-ID und Kontext-ID sind erforderlich' });
    }
    try {
      if (!(await conversationExists(convId, orgId, userId))) {
        return res.status(404).json({ message: 'Chat nicht gefunden' });
      }
      if (type === 'knowledge_base') {
        await query(
          `DELETE FROM chat_context_items
            WHERE conversation_id = $1 AND organization_id = $2 AND context_type = 'knowledge_base' AND knowledge_base_id = $3`,
          [convId, orgId, kbId],
        );
      } else {
        await query(
          `DELETE FROM chat_context_items
            WHERE conversation_id = $1 AND organization_id = $2 AND context_type = 'document' AND document_id = $3`,
          [convId, orgId, docId],
        );
      }
      await logAuditEvent({
        userId,
        organizationId: orgId,
        action: 'chat.context.removed',
        targetType: 'chat_conversation',
        targetId: String(convId),
        metadata: type === 'knowledge_base' ? { contextType: type, knowledgeBaseId: kbId } : { contextType: type, documentId: docId },
      });
      const items = await listContextItems(convId, orgId, userId);
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
