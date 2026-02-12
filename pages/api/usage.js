import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { query } from '../../lib/db';
import { enforceRateLimit, logApiError } from '../../lib/api-utils';

/**
 * GET /api/usage — Returns the current user's usage for this month.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'usage',
    identifier: `user:${session.user.id}`,
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
       WHERE user_id = $1
         AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)`,
      [session.user.id]
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
       WHERE user_id = $1
         AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)
       GROUP BY operation
       ORDER BY cost DESC`,
      [session.user.id]
    );

    // Cost limit
    const settings = await query(
      'SELECT cost_limit FROM settings WHERE user_id = $1',
      [session.user.id]
    );

    const summary = totals.rows[0];

    return res.status(200).json({
      month: new Date().toISOString().slice(0, 7),
      totalInputTokens: summary.total_input_tokens,
      totalOutputTokens: summary.total_output_tokens,
      totalCost: parseFloat(summary.total_cost),
      totalRequests: summary.total_requests,
      costLimit: settings.rows[0]?.cost_limit ? parseFloat(settings.rows[0].cost_limit) : null,
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
