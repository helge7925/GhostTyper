const { unlink } = require('fs/promises');
const path = require('path');
const { Pool } = require('pg');

const DEFAULT_DATABASE_URL = 'postgresql://transkription:transkription@localhost:5432/transkription';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
});
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

function log(event, details = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, details }));
}

function isSafeUploadPath(filePath) {
  if (!filePath) return false;
  const resolved = path.resolve(filePath);
  return resolved.startsWith(`${UPLOADS_DIR}${path.sep}`);
}

async function safeUnlink(filePath) {
  if (!isSafeUploadPath(filePath)) return;
  await unlink(filePath).catch(() => {});
}

async function main() {
  const settingsResult = await pool.query(
    "SELECT value FROM enterprise_settings WHERE key = 'retention_policy'"
  ).catch((error) => {
    if (error.code === '42P01') return { rows: [] };
    throw error;
  });
  const policy = settingsResult.rows[0]?.value || {};
  if (!policy.enabled || !policy.retentionDays) {
    log('retention.skipped', { reason: 'disabled' });
    return;
  }

  const retentionDays = Number.parseInt(policy.retentionDays, 10);
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    log('retention.invalid_policy', { retentionDays: policy.retentionDays });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const expired = await client.query(
      `SELECT id, file_path
       FROM transcriptions
       WHERE created_at < NOW() - ($1::int * interval '1 day')
       FOR UPDATE`,
      [retentionDays]
    );

    for (const row of expired.rows) {
      await safeUnlink(row.file_path);
      await client.query('DELETE FROM transcriptions WHERE id = $1', [row.id]);
    }

    await client.query('COMMIT');
    log('retention.completed', { retentionDays, deleted: expired.rows.length });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
