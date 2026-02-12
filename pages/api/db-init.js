import { initDatabase } from '../../lib/db-init';
import { enforceRateLimit, logApiError, serverError } from '../../lib/api-utils';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'db-init',
    limit: 5,
    windowMs: 60_000,
  });
  if (!allowed) return;

  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DB_INIT_API !== 'true') {
    return res.status(404).json({ message: 'Not found' });
  }

  const configuredSecret = process.env.DB_INIT_SECRET || null;
  if (!configuredSecret) {
    return serverError(res, 'DB-Initialisierung ist nicht konfiguriert');
  }

  const initSecret = req.headers['x-init-secret'];
  if (initSecret !== configuredSecret) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  try {
    await initDatabase();
    return res.status(200).json({ message: 'Database initialized' });
  } catch (error) {
    logApiError('DB init error', error);
    return serverError(res, 'Database initialization failed');
  }
}
