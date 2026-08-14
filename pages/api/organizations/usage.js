import { query } from '../../../lib/db';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { budgetLevel } from '../../../lib/budget-core';

const costMicros = `COALESCE(SUM(COALESCE(estimated_cost_micros,
  ROUND(COALESCE(estimated_cost, 0) * 1000000)::bigint)), 0)::bigint`;
const memberCostMicros = `COALESCE(SUM(COALESCE(l.estimated_cost_micros,
  ROUND(COALESCE(l.estimated_cost, 0) * 1000000)::bigint)), 0)::bigint`;

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'org-usage', identifier: `org:${req.org.id}:user:${req.userId}`,
    limit: 60, windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    const [totals, byOperation, byMember, settings, reservations] = await Promise.all([
      query(
        `SELECT COALESCE(SUM(input_tokens), 0)::bigint AS total_input_tokens,
                COALESCE(SUM(output_tokens), 0)::bigint AS total_output_tokens,
                ${costMicros} AS total_cost_micros, COUNT(*)::int AS total_requests
           FROM usage_log WHERE organization_id = $1
            AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)`,
        [req.org.id],
      ),
      query(
        `SELECT operation, COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
                COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
                ${costMicros} AS cost_micros, COUNT(*)::int AS requests
           FROM usage_log WHERE organization_id = $1
            AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)
          GROUP BY operation ORDER BY cost_micros DESC`,
        [req.org.id],
      ),
      query(
        `SELECT u.id AS user_id, u.email, u.name, m.role, mb.monthly_limit_micros,
                ${memberCostMicros} AS cost_micros,
                COUNT(l.id)::int AS requests
           FROM organization_members m JOIN users u ON u.id = m.user_id
           LEFT JOIN organization_member_budgets mb
             ON mb.organization_id = m.organization_id AND mb.user_id = m.user_id
           LEFT JOIN usage_log l ON l.user_id = m.user_id AND l.organization_id = m.organization_id
            AND l.created_at >= date_trunc('month', CURRENT_TIMESTAMP)
          WHERE m.organization_id = $1
          GROUP BY u.id, u.email, u.name, m.role, mb.monthly_limit_micros
          ORDER BY cost_micros DESC, u.email`,
        [req.org.id],
      ),
      query(
        `SELECT cost_limit_cents, member_monthly_budget_limit_cents
           FROM organization_settings WHERE organization_id = $1`,
        [req.org.id],
      ),
      query(
        `SELECT user_id, COALESCE(SUM(amount_micros), 0)::bigint AS amount_micros
           FROM budget_reservations WHERE organization_id = $1
            AND period_start = date_trunc('month', NOW())::date AND state = 'reserved'
          GROUP BY user_id`,
        [req.org.id],
      ),
    ]);
    const summary = totals.rows[0];
    const orgSettings = settings.rows[0] || {};
    const workspaceLimitMicros = orgSettings.cost_limit_cents > 0
      ? Number(orgSettings.cost_limit_cents) * 10_000 : null;
    const defaultMemberLimitMicros = orgSettings.member_monthly_budget_limit_cents > 0
      ? Number(orgSettings.member_monthly_budget_limit_cents) * 10_000 : null;
    const reservedByUser = new Map(reservations.rows.map((row) => [String(row.user_id), Number(row.amount_micros)]));
    const totalReservedMicros = reservations.rows.reduce((sum, row) => sum + Number(row.amount_micros), 0);
    const totalCostMicros = Number(summary.total_cost_micros);
    return res.status(200).json({
      month: new Date().toISOString().slice(0, 7),
      totalInputTokens: Number(summary.total_input_tokens),
      totalOutputTokens: Number(summary.total_output_tokens),
      totalCostMicros,
      totalCost: totalCostMicros / 1_000_000,
      totalReservedMicros,
      totalRequests: summary.total_requests,
      workspaceLimitMicros,
      defaultMemberLimitMicros,
      level: budgetLevel({ costMicros: totalCostMicros + totalReservedMicros, limitMicros: workspaceLimitMicros }),
      byOperation: byOperation.rows.map((row) => ({
        operation: row.operation,
        inputTokens: Number(row.input_tokens),
        outputTokens: Number(row.output_tokens),
        costMicros: Number(row.cost_micros),
        cost: Number(row.cost_micros) / 1_000_000,
        requests: row.requests,
      })),
      byMember: byMember.rows.map((row) => {
        const memberLimitMicros = row.monthly_limit_micros === null
          ? defaultMemberLimitMicros : Number(row.monthly_limit_micros);
        const memberCostMicros = Number(row.cost_micros);
        const memberReservedMicros = reservedByUser.get(String(row.user_id)) || 0;
        return {
          userId: row.user_id, email: row.email, name: row.name, role: row.role,
          costMicros: memberCostMicros, cost: memberCostMicros / 1_000_000,
          reservedMicros: memberReservedMicros, requests: row.requests, memberLimitMicros,
          remainingMicros: memberLimitMicros === null
            ? null : Math.max(0, memberLimitMicros - memberCostMicros - memberReservedMicros),
          level: budgetLevel({ costMicros: memberCostMicros + memberReservedMicros, limitMicros: memberLimitMicros }),
        };
      }),
    });
  } catch (error) {
    logApiError('Org usage API error', error);
    return serverError(res, 'Workspace usage could not be loaded.');
  }
}

export default withOrgScope({ permission: 'budget.read.org' }, handler);
