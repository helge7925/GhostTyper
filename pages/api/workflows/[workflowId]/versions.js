import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';
import { enforceRateLimit, logApiError, serverError } from '../../../../lib/api-utils';
import { listCustomWorkflowVersions } from '../../../../lib/workflow-service';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'workflows-versions',
    identifier: `user:${session.user.id}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    const workflowId = req.query.workflowId;
    const versions = await listCustomWorkflowVersions({
      userId: session.user.id,
      workflowId,
    });
    return res.status(200).json({ versions });
  } catch (error) {
    if (error?.code === '42P01' || error?.code === '42703') {
      return res.status(500).json({ message: 'Datenbank-Schema ist veraltet. Bitte /api/db-init ausführen.' });
    }
    if (error?.message === 'INVALID_WORKFLOW_ID') {
      return res.status(400).json({ message: 'Ungültige Workflow-ID' });
    }
    logApiError('Workflow versions API error', error);
    return serverError(res, 'Workflow-Versionen konnten nicht geladen werden');
  }
}
