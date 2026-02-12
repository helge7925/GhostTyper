import { requireAdmin } from '../../../lib/admin';
import { query } from '../../../lib/db';
import { getObservabilitySnapshot } from '../../../lib/observability';
import { logApiError } from '../../../lib/api-utils';

function toCountMap(rows) {
  return rows.reduce((accumulator, row) => {
    accumulator[row.status || row.stage] = Number(row.count) || 0;
    return accumulator;
  }, {});
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await requireAdmin(req, res);
  if (!session) return;

  try {
    const [statusCountsResult, eventCountsResult] = await Promise.all([
      query(
        `SELECT status, COUNT(*)::int AS count
         FROM transcriptions
         GROUP BY status`
      ),
      query(
        `SELECT stage, COUNT(*)::int AS count
         FROM transcription_events
         WHERE created_at >= NOW() - interval '15 minutes'
         GROUP BY stage`
      ),
    ]);

    const statusCounts = toCountMap(statusCountsResult.rows);
    const recentEventCounts = toCountMap(eventCountsResult.rows);
    const queued = statusCounts.queued || 0;
    const processing = statusCounts.processing || 0;
    const analyzing = statusCounts.analyzing || 0;

    return res.status(200).json({
      timestamp: new Date().toISOString(),
      runtime: getObservabilitySnapshot(),
      transcriptions: {
        activeJobs: queued + processing + analyzing,
        statusCounts,
        recentEventCounts15m: recentEventCounts,
      },
    });
  } catch (error) {
    logApiError('Admin observability error', error);
    return res.status(500).json({ message: 'Fehler beim Laden der Observability-Daten' });
  }
}
