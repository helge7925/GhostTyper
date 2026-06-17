import { withOrgScope } from '../../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { logAuditEvent } from '../../../lib/audit-log';
import { hasPermission } from '../../../lib/permissions';
import {
  KnowledgeError,
  deleteKnowledgeBase,
  getKnowledgeBase,
  listKnowledgeDirectories,
  listKnowledgeItems,
  updateKnowledgeBase,
} from '../../../lib/knowledge';

async function handler(req, res) {
  const orgId = req.org.id;
  const userId = req.userId;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'knowledge-base',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const kbId = Number.parseInt(String(req.query.id || ''), 10);
  if (!Number.isFinite(kbId)) {
    return res.status(400).json({ message: 'Ungültige Wissensbasis-ID' });
  }

  const kb = await getKnowledgeBase(kbId, orgId).catch((error) => {
    logApiError('Knowledge get failed', error);
    return null;
  });
  if (!kb) return res.status(404).json({ message: 'Wissensbasis nicht gefunden' });

  if (req.method === 'GET') {
    try {
      const [items, directories] = await Promise.all([
        listKnowledgeItems(kbId, orgId),
        listKnowledgeDirectories(kbId, orgId),
      ]);
      return res.status(200).json({ knowledgeBase: kb, items, directories });
    } catch (error) {
      logApiError('Knowledge detail failed', error);
      return serverError(res, 'Wissensbasis konnte nicht geladen werden.');
    }
  }

  if (req.method === 'PATCH') {
    if (!hasPermission(req.role, 'knowledge.write')) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
    }
    const { name, description } = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      const updated = await updateKnowledgeBase(kbId, orgId, { name, description });
      return res.status(200).json({ knowledgeBase: updated });
    } catch (error) {
      if (error instanceof KnowledgeError && error.code === 'INVALID_NAME') {
        return res.status(400).json({ message: error.message });
      }
      logApiError('Knowledge update failed', error);
      return serverError(res, 'Wissensbasis konnte nicht aktualisiert werden.');
    }
  }

  if (req.method === 'DELETE') {
    if (!hasPermission(req.role, 'knowledge.delete')) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
    }
    try {
      await deleteKnowledgeBase(kbId, orgId);
      await logAuditEvent({
        userId,
        organizationId: orgId,
        action: 'knowledge.base.deleted',
        targetType: 'knowledge_base',
        targetId: String(kbId),
      });
      return res.status(200).json({ ok: true });
    } catch (error) {
      logApiError('Knowledge delete failed', error);
      return serverError(res, 'Wissensbasis konnte nicht gelöscht werden.');
    }
  }

  res.setHeader('Allow', ['GET', 'PATCH', 'DELETE']);
  return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
}

export default withOrgScope({ permission: 'knowledge.read' }, handler);
