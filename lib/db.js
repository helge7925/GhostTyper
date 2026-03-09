import { Pool } from 'pg';
import { logError, logWarn, trackDbQueryError, trackDbSlowQuery } from './observability';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL ist nicht gesetzt. Bitte Umgebungsvariablen prüfen.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
  connectionTimeoutMillis: Number.parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10) || 5000, // How long to wait before timing out when connecting a new client
});

export default pool;

export async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 100) {
      trackDbSlowQuery(duration, result.rowCount);
      logWarn('db.slow_query', { durationMs: duration, rowCount: result.rowCount });
    }
    return result;
  } catch (error) {
    trackDbQueryError();
    logError('db.query_error', error);
    throw error;
  }
}
