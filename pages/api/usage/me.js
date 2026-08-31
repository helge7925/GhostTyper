import { withOrgScope } from '../../../lib/api/with-org-scope';
import { getSelfUsage } from '../../../lib/budget-service';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'self-usage',
    identifier: `org:${req.org.id}:user:${req.userId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;
  try {
    return res.status(200).json(await getSelfUsage(req.org.id, req.userId));
  } catch (error) {
    logApiError('Self usage API failed', error);
    return serverError(res, 'Personal usage could not be loaded.');
  }
}

export default withOrgScope({ permission: 'budget.read.self' }, handler);
