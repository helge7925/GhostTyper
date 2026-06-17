import { withOrgScope } from '../../../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError, serverError } from '../../../../lib/api-utils';
import { hasPermission } from '../../../../lib/permissions';
import {
  KnowledgeError,
  createKnowledgeDirectory,
  deleteKnowledgeDirectory,
  getKnowledgeBase,
  listKnowledgeDirectories,
  updateKnowledgeDirectory,
} from '../../../../lib/knowledge';

function mapKnowledgeError(error, res) {
  if (error instanceof KnowledgeError) {
    if (error.code === 'INVALID_NAME' || error.code === 'INVALID_DIRECTORY') {
      return res.status(400).json({ message: error.message });
    }
  }
  return null;
}

async function handler(req, res) {
  const orgId = req.org.id;
  const userId = req.userId;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'knowledge-directories',
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

  if (req.method !== 'GET' && !hasPermission(req.role, 'knowledge.write')) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
  }

  try {
    if (req.method === 'GET') {
      const directories = await listKnowledgeDirectories(kbId, orgId);
      return res.status(200).json({ directories });
    }

    if (req.method === 'POST') {
      const { name, parentId } = req.body && typeof req.body === 'object' ? req.body : {};
      const directory = await createKnowledgeDirectory({
        knowledgeBaseId: kbId,
        organizationId: orgId,
        name,
        parentId: parentId != null ? Number(parentId) : null,
      });
      return res.status(201).json({ directory });
    }

    if (req.method === 'PATCH') {
      const { directoryId, name } = req.body && typeof req.body === 'object' ? req.body : {};
      const id = Number(directoryId);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ message: 'Verzeichnis-ID ist erforderlich' });
      }
      const directory = await updateKnowledgeDirectory({ directoryId: id, knowledgeBaseId: kbId, organizationId: orgId, name });
      if (!directory) return res.status(404).json({ message: 'Verzeichnis nicht gefunden' });
      return res.status(200).json({ directory });
    }

    if (req.method === 'DELETE') {
      const id = Number(req.query.directoryId);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ message: 'Verzeichnis-ID ist erforderlich' });
      }
      await deleteKnowledgeDirectory({ directoryId: id, knowledgeBaseId: kbId, organizationId: orgId });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', ['GET', 'POST', 'PATCH', 'DELETE']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    if (mapKnowledgeError(error, res)) return undefined;
    logApiError('Knowledge directories failed', error);
    return serverError(res, 'Verzeichnisse konnten nicht verarbeitet werden.');
  }
}

export default withOrgScope({ permission: 'knowledge.read' }, handler);
