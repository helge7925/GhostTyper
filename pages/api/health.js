import { query } from '../../lib/db';
import { getObservabilitySnapshot } from '../../lib/observability';
import { ensureTranscriptionWorkerRunning } from '../../lib/transcription-worker';

export default async function handler(req, res) {
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
