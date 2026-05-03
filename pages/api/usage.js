import { query } from '../../lib/db';
import { enforceRateLimit, logApiError } from '../../lib/api-utils';
import { calculateBudgetTrafficLight, resolveEffectiveBudgetLimit } from '../../lib/budget-guardrails';
import { withOrgScope } from '../../lib/api/with-org-scope';

/**
 * GET /api/usage — Returns the current organisation's usage for this month.
 */
async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'usage',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    // Current month totals
    const totals = await query(
      `SELECT
         COALESCE(SUM(input_tokens), 0)::int AS total_input_tokens,
         COALESCE(SUM(output_tokens), 0)::int AS total_output_tokens,
         COALESCE(SUM(estimated_cost), 0)::numeric AS total_cost,
         COUNT(*)::int AS total_requests
       FROM usage_log
       WHERE organization_id = $1
         AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)`,
      [orgId]
    );

    // Breakdown by operation
    const byOperation = await query(
      `SELECT
         operation,
         COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
         COALESCE(SUM(output_tokens), 0)::int AS output_tokens,
         COALESCE(SUM(estimated_cost), 0)::numeric AS cost,
         COUNT(*)::int AS requests
       FROM usage_log
       WHERE organization_id = $1
         AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)
       GROUP BY operation
       ORDER BY cost DESC`,
      [orgId]
    );

    // Cost limit (still user-scoped: personal cost cap)
    let settings;
    try {
      settings = await query(
        'SELECT cost_limit, member_monthly_budget_limit FROM settings WHERE user_id = $1',
        [userId]
      );
    } catch (settingsError) {
      if (settingsError?.code !== '42703') throw settingsError;
      settings = await query(
        'SELECT cost_limit, NULL::numeric AS member_monthly_budget_limit FROM settings WHERE user_id = $1',
        [userId]
      );
    }

    const summary = totals.rows[0];
    const accountLimit = settings.rows[0]?.cost_limit ?? null;
    const memberMonthlyBudgetLimit = settings.rows[0]?.member_monthly_budget_limit ?? null;
    const effectiveLimit = resolveEffectiveBudgetLimit({
      costLimit: accountLimit,
      memberMonthlyBudgetLimit,
    });
    const totalCost = parseFloat(summary.total_cost);
    const trafficLight = calculateBudgetTrafficLight({
      currentCost: totalCost,
      costLimit: effectiveLimit,
      estimatedNextCost: 0,
    });

    return res.status(200).json({
      month: new Date().toISOString().slice(0, 7),
      totalInputTokens: summary.total_input_tokens,
      totalOutputTokens: summary.total_output_tokens,
      totalCost,
      totalRequests: summary.total_requests,
      costLimit: accountLimit !== null ? parseFloat(accountLimit) : null,
      memberMonthlyBudgetLimit: memberMonthlyBudgetLimit !== null ? parseFloat(memberMonthlyBudgetLimit) : null,
      effectiveLimit: effectiveLimit !== null ? parseFloat(effectiveLimit) : null,
      budgetTrafficLight: trafficLight,
      byOperation: byOperation.rows.map(r => ({
        operation: r.operation,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        cost: parseFloat(r.cost),
        requests: r.requests,
      })),
    });
  } catch (error) {
    logApiError('Usage API error', error);
    return res.status(500).json({ message: 'Fehler beim Laden der Nutzungsdaten' });
  }
}

export default withOrgScope(handler);
