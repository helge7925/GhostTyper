import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { listWorkflows, upsertCustomWorkflow } from '../../../lib/workflow-service';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { logAuditEvent } from '../../../lib/audit-log';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'workflows-list',
    identifier: `user:${session.user.id}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    if (req.method === 'GET') {
      const workflows = await listWorkflows(session.user.id);
      return res.status(200).json(workflows);
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const saved = await upsertCustomWorkflow({
        userId: session.user.id,
        workflowId: body.workflowId || null,
        workflowKey: body.workflowKey || null,
        name: body.name,
        description: body.description,
        steps: body.steps,
        note: body.note || null,
      });

      await logAuditEvent({
        userId: session.user.id,
        action: body.workflowId ? 'workflow.version_created' : 'workflow.created',
        targetType: 'workflow',
        targetId: saved?.id || body.workflowId || null,
        metadata: {
          version: saved?.version || 1,
          stepCount: Array.isArray(saved?.steps) ? saved.steps.length : 0,
        },
      });

      return res.status(201).json(saved);
    }

    return res.status(405).json({ message: 'Method not allowed' });
  } catch (error) {
    if (error?.code === '42P01' || error?.code === '42703') {
      return res.status(500).json({ message: 'Datenbank-Schema ist veraltet. Bitte /api/db-init ausführen.' });
    }
    if (error?.message === 'INVALID_WORKFLOW_DRAFT') {
      return res.status(400).json({
        message: 'Workflow-Definition ist ungültig',
        errors: error.details || [],
      });
    }
    if (error?.message === 'WORKFLOW_NOT_FOUND') {
      return res.status(404).json({ message: 'Workflow nicht gefunden' });
    }
    logApiError('Workflows API error', error);
    return serverError(res, 'Workflow konnte nicht gespeichert werden');
  }
}
