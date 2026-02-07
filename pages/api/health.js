import { query } from '../../lib/db';

export default async function handler(req, res) {
  let dbStatus = 'unknown';

  try {
    await query('SELECT 1');
    dbStatus = 'connected';
  } catch {
    dbStatus = 'disconnected';
  }

  const healthy = dbStatus === 'connected';

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    service: 'transkription-webapp',
    database: dbStatus,
  });
}
