import { withOrgScope } from '../../../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError, serverError } from '../../../../lib/api-utils';
import { logAuditEvent } from '../../../../lib/audit-log';
import { hasPermission } from '../../../../lib/permissions';
import {
  KnowledgeError,
  addKnowledgeItem,
  getKnowledgeBase,
  listKnowledgeItems,
  removeKnowledgeItem,
  updateKnowledgeItem,
} from '../../../../lib/knowledge';

function mapKnowledgeError(error, res) {
  if (error instanceof KnowledgeError) {
    if (error.code === 'DOCUMENT_NOT_ALLOWED' || error.code === 'INVALID_DIRECTORY') {
      return res.status(400).json({ message: error.message });
    }
  }
  return null;
}

async function handler(req, res) {
  const orgId = req.org.id;
  const userId = req.userId;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'knowledge-items',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const kbId = Number.parseInt(String(req.query.id || ''), 10);
  if (!Number.isFinite(kbId)) {
    return res.status(400).json({ message: 'Ungültige Wissensbasis-ID' });
  }
  const kb = await getKnowledgeBase(kbId, orgId).catch(() => null);
  if (!kb) return res.status(404).json({ message: 'Wissensbasis nicht gefunden' });

  const isWrite = req.method !== 'GET';
  if (isWrite && !hasPermission(req.role, 'knowledge.write')) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
  }

  try {
    if (req.method === 'GET') {
      const items = await listKnowledgeItems(kbId, orgId);
      return res.status(200).json({ items });
    }

    if (req.method === 'POST') {
      const { documentId, directoryId, retrievalMode } = req.body && typeof req.body === 'object' ? req.body : {};
      const docId = Number(documentId);
      if (!Number.isFinite(docId)) {
        return res.status(400).json({ message: 'Dokument-ID ist erforderlich' });
      }
      await addKnowledgeItem({
        knowledgeBaseId: kbId,
        organizationId: orgId,
        documentId: docId,
        directoryId: directoryId != null ? Number(directoryId) : null,
        retrievalMode,
      });
      await logAuditEvent({
        userId,
        organizationId: orgId,
        action: 'knowledge.item.added',
        targetType: 'knowledge_base',
        targetId: String(kbId),
        metadata: { documentId: docId },
      });
      const items = await listKnowledgeItems(kbId, orgId);
      return res.status(200).json({ items });
    }

    if (req.method === 'PATCH') {
      const { itemId, retrievalMode, directoryId } = req.body && typeof req.body === 'object' ? req.body : {};
      const id = Number(itemId);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ message: 'Item-ID ist erforderlich' });
      }
      await updateKnowledgeItem({
        itemId: id,
        knowledgeBaseId: kbId,
        organizationId: orgId,
        retrievalMode,
        directoryId: directoryId === undefined ? undefined : (directoryId != null ? Number(directoryId) : null),
      });
      const items = await listKnowledgeItems(kbId, orgId);
      return res.status(200).json({ items });
    }

    if (req.method === 'DELETE') {
      const id = Number(req.query.itemId);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ message: 'Item-ID ist erforderlich' });
      }
      await removeKnowledgeItem({ itemId: id, knowledgeBaseId: kbId, organizationId: orgId });
      const items = await listKnowledgeItems(kbId, orgId);
      return res.status(200).json({ items });
    }

    res.setHeader('Allow', ['GET', 'POST', 'PATCH', 'DELETE']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    if (mapKnowledgeError(error, res)) return undefined;
    logApiError('Knowledge items failed', error);
    return serverError(res, 'Dokumente der Wissensbasis konnten nicht verarbeitet werden.');
  }
}

export default withOrgScope({ permission: 'knowledge.read' }, handler);
