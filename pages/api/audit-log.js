import { enforceRateLimit, logApiError } from '../../lib/api-utils';
import { listAuditEventsForOrg } from '../../lib/audit-log';
import { withOrgScope } from '../../lib/api/with-org-scope';

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'audit-log',
    identifier: `org:${req.org.id}:user:${req.userId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    const limit = Number.parseInt(req.query.limit, 10) || 80;
    const action = typeof req.query.action === 'string' ? req.query.action : null;
    const severity = typeof req.query.severity === 'string' ? req.query.severity : null;
    const since = req.query.since ? new Date(req.query.since) : null;
    const until = req.query.until ? new Date(req.query.until) : null;

    const events = await listAuditEventsForOrg(req.org.id, { limit, action, severity, since, until });
    return res.status(200).json({ events });
  } catch (error) {
    if (error?.code === '42P01' || error?.code === '42703') {
      return res.status(200).json({ events: [] });
    }
    logApiError('Audit log API error', error);
    return res.status(500).json({ message: 'Audit-Log konnte nicht geladen werden' });
  }
}

export default withOrgScope({ permission: 'audit.read' }, handler);
