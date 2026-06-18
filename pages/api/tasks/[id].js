import { withOrgScope } from '../../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { logAuditEvent } from '../../../lib/audit-log';
import { hasPermission } from '../../../lib/permissions';
import { deleteTask, updateTask } from '../../../lib/tasks';

async function handler(req, res) {
  const orgId = req.org.id;
  const userId = req.userId;
  const id = Number(req.query.id);
  if (!Number.isFinite(id)) return res.status(400).json({ message: 'Ungültige Aufgaben-ID' });

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'tasks-item',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  if (req.method === 'PATCH') {
    if (!hasPermission(req.role, 'task.write')) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
    }
    try {
      const task = await updateTask({ id, organizationId: orgId, patch: req.body || {} });
      if (!task) return res.status(404).json({ message: 'Aufgabe nicht gefunden' });
      await logAuditEvent({ userId, organizationId: orgId, action: 'task.updated', targetType: 'task', targetId: String(id), metadata: req.body || {} });
      return res.status(200).json({ task });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ message: error.message });
      logApiError('Task update failed', error);
      return serverError(res, 'Aufgabe konnte nicht aktualisiert werden.');
    }
  }

  if (req.method === 'DELETE') {
    if (!hasPermission(req.role, 'task.delete')) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
    }
    try {
      const deleted = await deleteTask({ id, organizationId: orgId });
      if (!deleted) return res.status(404).json({ message: 'Aufgabe nicht gefunden' });
      await logAuditEvent({ userId, organizationId: orgId, action: 'task.deleted', targetType: 'task', targetId: String(id) });
      return res.status(200).json({ ok: true });
    } catch (error) {
      logApiError('Task delete failed', error);
      return serverError(res, 'Aufgabe konnte nicht gelöscht werden.');
    }
  }

  res.setHeader('Allow', ['PATCH', 'DELETE']);
  return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
}

export default withOrgScope({ permission: 'task.read' }, handler);
