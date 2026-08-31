import { query } from '../../../lib/db';
import { enforceRateLimit, logApiError } from '../../../lib/api-utils';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { buildLiveUsagePayload, parseLiveUsageScope, withLiveUsageBudget } from '../../../lib/live-usage';
import { checkCostLimit } from '../../../lib/usage';
import { hasPermission } from '../../../lib/permissions';

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'usage-live',
    identifier: `org:${req.org.id}:user:${req.userId}`,
    limit: 12,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    const scope = parseLiveUsageScope(req.query);
    const transcriptionResult = await query(
       `SELECT id, user_id, status, source, meeting_ended_at, updated_at
         FROM transcriptions WHERE id = $1 AND organization_id = $2`,
      [scope.transcriptionId, req.org.id],
    );
    if (transcriptionResult.rowCount === 0) {
      return res.status(404).json({ code: 'USAGE_SCOPE_NOT_FOUND' });
    }
    const transcription = transcriptionResult.rows[0];
    if (Number(transcription.user_id) !== Number(req.userId)
        && !hasPermission(req.role, 'budget.read.org')) {
      return res.status(403).json({ code: 'FORBIDDEN', permission: 'budget.read.org' });
    }
    if (scope.scope === 'meeting' && transcription.source !== 'vexa') {
      return res.status(404).json({ code: 'MEETING_SCOPE_NOT_FOUND' });
    }
    let usageResult;
    try {
      usageResult = await query(
         `SELECT (COALESCE(SUM(COALESCE(estimated_cost_micros,
                    ROUND(COALESCE(estimated_cost, 0) * 1000000)::bigint)), 0) / 1000000.0)::numeric AS total_cost,
                COUNT(*)::int AS total_requests, MAX(created_at) AS last_usage_at
           FROM usage_log
          WHERE organization_id = $1 AND transcription_id = $2`,
        [req.org.id, scope.transcriptionId],
      );
    } catch (error) {
      if (error?.code === '42703') {
        const fallback = buildLiveUsagePayload({ usageRow: {}, transcription });
        return res.status(200).json({
          ...fallback,
          totalCost: null,
          state: 'unavailable',
        });
      }
      throw error;
    }
    const payload = buildLiveUsagePayload({
      usageRow: usageResult.rows[0],
      transcription,
    });
    let costState = null;
    try {
      costState = await checkCostLimit(req.userId, req.org.id);
    } catch {
      // Session cost remains useful when the aggregate budget lookup is temporarily unavailable.
    }
    return res.status(200).json(withLiveUsageBudget(payload, costState));
  } catch (error) {
    if (error.message === 'USAGE_SCOPE_REQUIRED' || error.message === 'USAGE_SCOPE_INVALID') {
      return res.status(400).json({ code: error.message });
    }
    logApiError('Live usage API error', error);
    return res.status(500).json({ message: 'Live-Kosten konnten nicht geladen werden.' });
  }
}

export default withOrgScope({ permission: 'budget.read.self' }, handler);
