import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { deactivateCustomWorkflow } from '../../../lib/workflow-service';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { logAuditEvent } from '../../../lib/audit-log';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'workflows-delete',
    identifier: `user:${session.user.id}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    const removed = await deactivateCustomWorkflow({
      userId: session.user.id,
      workflowId: req.query.workflowId,
    });
    if (!removed) {
      return res.status(404).json({ message: 'Workflow nicht gefunden' });
    }

    await logAuditEvent({
      userId: session.user.id,
      action: 'workflow.deactivated',
      targetType: 'workflow',
      targetId: String(req.query.workflowId || ''),
    });

    return res.status(200).json({ message: 'Workflow deaktiviert' });
  } catch (error) {
    if (error?.code === '42P01' || error?.code === '42703') {
      return res.status(500).json({ message: 'Datenbank-Schema ist veraltet. Bitte /api/db-init ausführen.' });
    }
    if (error?.message === 'INVALID_WORKFLOW_ID') {
      return res.status(400).json({ message: 'Ungültige Workflow-ID' });
    }
    logApiError('Workflow delete API error', error);
    return serverError(res, 'Workflow konnte nicht deaktiviert werden');
  }
}
