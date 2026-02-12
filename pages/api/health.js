import { query } from '../../lib/db';
import { getObservabilitySnapshot } from '../../lib/observability';
import { ensureTranscriptionWorkerRunning } from '../../lib/transcription-worker';
import { enforceRateLimit } from '../../lib/api-utils';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'health',
    limit: 180,
    windowMs: 60_000,
  }, 'Zu viele Healthchecks. Bitte später erneut versuchen.');
  if (!allowed) return;

  ensureTranscriptionWorkerRunning();

  let dbStatus = 'unknown';

  try {
    await query('SELECT 1');
    dbStatus = 'connected';
  } catch {
    dbStatus = 'disconnected';
  }

  const healthy = dbStatus === 'connected';
  const observability = getObservabilitySnapshot();

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    service: 'transkription-webapp',
    database: dbStatus,
    observability: {
      counters: observability.counters,
      worker: observability.worker,
      db: observability.db,
    },
  });
}
