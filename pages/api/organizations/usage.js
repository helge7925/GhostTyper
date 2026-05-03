import { query } from '../../../lib/db';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { calculateBudgetTrafficLight, resolveEffectiveBudgetLimit } from '../../../lib/budget-guardrails';

/**
 * GET /api/organizations/usage
 *
 * Returns the active org's spend for the current month, broken down by:
 *   - totals (cost, requests, tokens)
 *   - per operation (transcription / analysis / ocr / translation / ...)
 *   - per member (so admins can see who's driving cost)
 * Plus the resolved cost-limit traffic light.
 *
 * Read-only; available to every member with `org.read`.
 */
function centsToEuros(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n / 100 : null;
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }

  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'org-usage',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    const totals = await query(
      `SELECT
         COALESCE(SUM(input_tokens), 0)::bigint  AS total_input_tokens,
         COALESCE(SUM(output_tokens), 0)::bigint AS total_output_tokens,
         COALESCE(SUM(estimated_cost), 0)::numeric AS total_cost,
         COUNT(*)::int AS total_requests
       FROM usage_log
       WHERE organization_id = $1
         AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)`,
      [orgId],
    );

    const byOperation = await query(
      `SELECT
         operation,
         COALESCE(SUM(input_tokens), 0)::bigint  AS input_tokens,
         COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
         COALESCE(SUM(estimated_cost), 0)::numeric AS cost,
         COUNT(*)::int AS requests
       FROM usage_log
       WHERE organization_id = $1
         AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)
       GROUP BY operation
       ORDER BY cost DESC`,
      [orgId],
    );

    const byMember = await query(
      `SELECT
         u.id AS user_id,
         u.email,
         u.name,
         m.role,
         COALESCE(SUM(l.estimated_cost), 0)::numeric AS cost,
         COUNT(l.id)::int AS requests
       FROM organization_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN usage_log l
         ON l.user_id = m.user_id
        AND l.organization_id = m.organization_id
        AND l.created_at >= date_trunc('month', CURRENT_TIMESTAMP)
       WHERE m.organization_id = $1
       GROUP BY u.id, u.email, u.name, m.role
       ORDER BY cost DESC, u.email ASC`,
      [orgId],
    );

    // Cost-limit resolution: combine personal (caller) + org-level limits.
    let personalCostLimit = null;
    let personalMemberLimit = null;
    try {
      const settingsRow = await query(
        'SELECT cost_limit, member_monthly_budget_limit FROM settings WHERE user_id = $1',
        [userId],
      );
      personalCostLimit = settingsRow.rows[0]?.cost_limit ?? null;
      personalMemberLimit = settingsRow.rows[0]?.member_monthly_budget_limit ?? null;
    } catch (error) {
      if (error?.code !== '42703' && error?.code !== '42P01') throw error;
    }

    let orgCostLimit = null;
    let orgMemberLimit = null;
    try {
      const orgSettings = await query(
        `SELECT cost_limit_cents, member_monthly_budget_limit_cents
           FROM organization_settings
          WHERE organization_id = $1`,
        [orgId],
      );
      orgCostLimit = centsToEuros(orgSettings.rows[0]?.cost_limit_cents);
      orgMemberLimit = centsToEuros(orgSettings.rows[0]?.member_monthly_budget_limit_cents);
    } catch (error) {
      if (error?.code !== '42703' && error?.code !== '42P01') throw error;
    }

    const limit = resolveEffectiveBudgetLimit({
      costLimit: personalCostLimit,
      memberMonthlyBudgetLimit: personalMemberLimit,
      organizationCostLimit: orgCostLimit,
      organizationMemberMonthlyBudgetLimit: orgMemberLimit,
    });

    const summary = totals.rows[0];
    const totalCost = parseFloat(summary.total_cost);
    const trafficLight = calculateBudgetTrafficLight({
      currentCost: totalCost,
      costLimit: limit,
      estimatedNextCost: 0,
    });

    return res.status(200).json({
      month: new Date().toISOString().slice(0, 7),
      totalInputTokens: Number(summary.total_input_tokens),
      totalOutputTokens: Number(summary.total_output_tokens),
      totalCost,
      totalRequests: summary.total_requests,
      effectiveLimit: limit !== null ? Number(limit) : null,
      organizationCostLimit: orgCostLimit,
      organizationMemberMonthlyBudgetLimit: orgMemberLimit,
      personalCostLimit: personalCostLimit !== null && personalCostLimit !== undefined ? Number(personalCostLimit) : null,
      personalMemberMonthlyBudgetLimit:
        personalMemberLimit !== null && personalMemberLimit !== undefined ? Number(personalMemberLimit) : null,
      trafficLight,
      byOperation: byOperation.rows.map((row) => ({
        operation: row.operation,
        inputTokens: Number(row.input_tokens),
        outputTokens: Number(row.output_tokens),
        cost: parseFloat(row.cost),
        requests: row.requests,
      })),
      byMember: byMember.rows.map((row) => ({
        userId: row.user_id,
        email: row.email,
        name: row.name,
        role: row.role,
        cost: parseFloat(row.cost),
        requests: row.requests,
      })),
    });
  } catch (error) {
    logApiError('Org usage API error', error);
    return serverError(res, 'Workspace-Nutzungsdaten konnten nicht geladen werden.');
  }
}

export default withOrgScope({ permission: 'org.read' }, handler);
