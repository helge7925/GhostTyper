import { requireAdmin } from '../../../lib/admin';
import { query } from '../../../lib/db';

/**
 * GET /api/admin/usage — Returns usage overview for all users (admin only).
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await requireAdmin(req, res);
  if (!session) return;

  try {
    const result = await query(
      `SELECT
         u.id AS user_id,
         u.email,
         u.name,
         COALESCE(SUM(ul.input_tokens), 0)::int AS total_input_tokens,
         COALESCE(SUM(ul.output_tokens), 0)::int AS total_output_tokens,
         COALESCE(SUM(ul.estimated_cost), 0)::numeric AS total_cost,
         COUNT(ul.id)::int AS total_requests,
         s.cost_limit
       FROM users u
       LEFT JOIN usage_log ul ON ul.user_id = u.id
         AND ul.created_at >= date_trunc('month', CURRENT_TIMESTAMP)
       LEFT JOIN settings s ON s.user_id = u.id
       GROUP BY u.id, u.email, u.name, s.cost_limit
       ORDER BY total_cost DESC`
    );

    return res.status(200).json({
      month: new Date().toISOString().slice(0, 7),
      users: result.rows.map(r => ({
        userId: r.user_id,
        email: r.email,
        name: r.name,
        totalInputTokens: r.total_input_tokens,
        totalOutputTokens: r.total_output_tokens,
        totalCost: parseFloat(r.total_cost),
        totalRequests: r.total_requests,
        costLimit: r.cost_limit ? parseFloat(r.cost_limit) : null,
      })),
    });
  } catch (error) {
    console.error('Admin usage API error:', error);
    return res.status(500).json({ message: 'Fehler beim Laden der Nutzungsdaten' });
  }
}
