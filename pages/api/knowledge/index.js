import { withOrgScope } from '../../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { logAuditEvent } from '../../../lib/audit-log';
import { hasPermission } from '../../../lib/permissions';
import { KnowledgeError, createKnowledgeBase, listKnowledgeBases } from '../../../lib/knowledge';

async function handler(req, res) {
  const orgId = req.org.id;
  const userId = req.userId;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'knowledge-bases',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  if (req.method === 'GET') {
    try {
      const knowledgeBases = await listKnowledgeBases(orgId);
      return res.status(200).json({ knowledgeBases });
    } catch (error) {
      logApiError('Knowledge list failed', error);
      return serverError(res, 'Wissensbasen konnten nicht geladen werden.');
    }
  }

  if (req.method === 'POST') {
    if (!hasPermission(req.role, 'knowledge.write')) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
    }
    const { name, description } = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      const kb = await createKnowledgeBase({ organizationId: orgId, ownerUserId: userId, name, description });
      await logAuditEvent({
        userId,
        organizationId: orgId,
        action: 'knowledge.base.created',
        targetType: 'knowledge_base',
        targetId: String(kb.id),
      });
      return res.status(201).json({ knowledgeBase: kb });
    } catch (error) {
      if (error instanceof KnowledgeError && error.code === 'INVALID_NAME') {
        return res.status(400).json({ message: error.message });
      }
      logApiError('Knowledge create failed', error);
      return serverError(res, 'Wissensbasis konnte nicht erstellt werden.');
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
}

export default withOrgScope({ permission: 'knowledge.read' }, handler);
