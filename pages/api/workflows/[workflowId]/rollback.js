import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';
import { enforceRateLimit, logApiError, serverError } from '../../../../lib/api-utils';
import { rollbackCustomWorkflowVersion } from '../../../../lib/workflow-service';
import { logAuditEvent } from '../../../../lib/audit-log';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'workflows-rollback',
    identifier: `user:${session.user.id}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    const workflowId = req.query.workflowId;
    const version = req.body?.version;
    const updated = await rollbackCustomWorkflowVersion({
      userId: session.user.id,
      workflowId,
      version,
    });

    await logAuditEvent({
      userId: session.user.id,
      action: 'workflow.rollback',
      targetType: 'workflow',
      targetId: workflowId,
      metadata: {
        version: Number(version),
      },
    });

    return res.status(200).json(updated);
  } catch (error) {
    if (error?.code === '42P01' || error?.code === '42703') {
      return res.status(500).json({ message: 'Datenbank-Schema ist veraltet. Bitte /api/db-init ausführen.' });
    }
    if (error?.message === 'INVALID_WORKFLOW_ROLLBACK') {
      return res.status(400).json({ message: 'Ungültige Rollback-Parameter' });
    }
    if (error?.message === 'WORKFLOW_NOT_FOUND') {
      return res.status(404).json({ message: 'Workflow nicht gefunden' });
    }
    if (error?.message === 'WORKFLOW_VERSION_NOT_FOUND') {
      return res.status(404).json({ message: 'Workflow-Version nicht gefunden' });
    }
    logApiError('Workflow rollback API error', error);
    return serverError(res, 'Rollback fehlgeschlagen');
  }
}
