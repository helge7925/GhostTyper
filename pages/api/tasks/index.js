import { withOrgScope } from '../../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { hasPermission } from '../../../lib/permissions';
import { createTask, listTasks } from '../../../lib/tasks';
import { logAuditEvent } from '../../../lib/audit-log';

async function handler(req, res) {
  const orgId = req.org.id;
  const userId = req.userId;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'tasks',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  if (req.method === 'GET') {
    try {
      const transcriptionId = Number(req.query.transcriptionId);
      const assigneeUserId = Number(req.query.assigneeUserId);
      const tasks = await listTasks({
        organizationId: orgId,
        transcriptionId: Number.isFinite(transcriptionId) ? transcriptionId : null,
        status: typeof req.query.status === 'string' ? req.query.status : null,
        assigneeUserId: Number.isFinite(assigneeUserId) ? assigneeUserId : null,
      });
      return res.status(200).json({ tasks });
    } catch (error) {
      logApiError('Tasks list failed', error);
      return serverError(res, 'Aufgaben konnten nicht geladen werden.');
    }
  }

  if (req.method === 'POST') {
    if (!hasPermission(req.role, 'task.write')) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
    }
    try {
      const task = await createTask({
        organizationId: orgId,
        createdBy: userId,
        documentId: req.body?.documentId || null,
        transcriptionId: req.body?.transcriptionId || null,
        task: req.body || {},
      });
      await logAuditEvent({
        userId,
        organizationId: orgId,
        action: 'task.created',
        targetType: 'task',
        targetId: String(task.id),
      });
      return res.status(201).json({ task });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ message: error.message });
      logApiError('Task create failed', error);
      return serverError(res, 'Aufgabe konnte nicht erstellt werden.');
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
}

export default withOrgScope({ permission: 'task.read' }, handler);
