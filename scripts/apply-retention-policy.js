/**
 * Retention policy runner.
 *
 *   node scripts/apply-retention-policy.js              # apply all configured policies
 *   node scripts/apply-retention-policy.js --dry-run    # report what would be deleted
 *
 * Two layers of policy, evaluated independently:
 *
 *   1. Tenant-wide fallback   — `enterprise_settings.value->>retention_policy`
 *      Applies to every transcription if no per-org override is set. Backwards
 *      compatible with the old single-tenant deployment.
 *
 *   2. Per-organisation       — `organization_settings.retention_days`
 *                              `organization_settings.audit_retention_days`
 *      Wins for transcriptions/audit-events of that workspace; org-level
 *      values take precedence over the tenant fallback.
 *
 * Designed to run as a daily cron — idempotent, transactional per-org,
 * never deletes data on dry-run, logs every decision as a single line of
 * JSON for log shippers.
 */

const { unlink } = require('fs/promises');
const path = require('path');
const { Pool } = require('pg');

const DEFAULT_DATABASE_URL = 'postgresql://transkription:transkription@localhost:5432/transkription';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
});
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
const DRY_RUN = process.argv.includes('--dry-run');

function log(event, details = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, dryRun: DRY_RUN, details }));
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

function toPositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
}

async function loadTenantPolicy() {
  try {
    const result = await pool.query(
      "SELECT value FROM enterprise_settings WHERE key = 'retention_policy'",
    );
    const policy = result.rows[0]?.value || {};
    if (!policy.enabled) return null;
    const days = toPositiveInt(policy.retentionDays);
    return days ? { transcriptionDays: days } : null;
  } catch (error) {
    if (error.code === '42P01') return null;
    throw error;
  }
}

async function loadOrgPolicies() {
  try {
    const result = await pool.query(
      `SELECT organization_id, retention_days, audit_retention_days
         FROM organization_settings
        WHERE retention_days IS NOT NULL OR audit_retention_days IS NOT NULL`,
    );
    return result.rows.map((row) => ({
      organizationId: row.organization_id,
      transcriptionDays: toPositiveInt(row.retention_days),
      auditDays: toPositiveInt(row.audit_retention_days),
    }));
  } catch (error) {
    if (error.code === '42P01') return [];
    throw error;
  }
}

async function expireOrgTranscriptions(client, organizationId, days) {
  const expired = await client.query(
    `SELECT id, file_path
       FROM transcriptions
      WHERE organization_id = $1
        AND created_at < NOW() - ($2::int * interval '1 day')
      FOR UPDATE`,
    [organizationId, days],
  );
  if (DRY_RUN) {
    log('retention.transcriptions.dry_run', { organizationId, days, would_delete: expired.rows.length });
    return expired.rows.length;
  }
  for (const row of expired.rows) {
    await safeUnlink(row.file_path);
    await client.query('DELETE FROM transcriptions WHERE id = $1', [row.id]);
  }
  log('retention.transcriptions.applied', { organizationId, days, deleted: expired.rows.length });
  return expired.rows.length;
}

async function expireFallbackTranscriptions(client, days) {
  // Only rows that don't already fall under a per-org policy with a different
  // value. The cleanest interpretation is "rows that have no org override":
  // we exclude any organization that has its own retention_days set.
  const expired = await client.query(
    `SELECT t.id, t.file_path
       FROM transcriptions t
       LEFT JOIN organization_settings s ON s.organization_id = t.organization_id
      WHERE s.retention_days IS NULL
        AND t.created_at < NOW() - ($1::int * interval '1 day')
      FOR UPDATE`,
    [days],
  );
  if (DRY_RUN) {
    log('retention.fallback.dry_run', { days, would_delete: expired.rows.length });
    return expired.rows.length;
  }
  for (const row of expired.rows) {
    await safeUnlink(row.file_path);
    await client.query('DELETE FROM transcriptions WHERE id = $1', [row.id]);
  }
  log('retention.fallback.applied', { days, deleted: expired.rows.length });
  return expired.rows.length;
}

async function expireOrgAudit(client, organizationId, days) {
  if (DRY_RUN) {
    const probe = await client.query(
      `SELECT count(*)::int AS n
         FROM audit_log
        WHERE organization_id = $1
          AND created_at < NOW() - ($2::int * interval '1 day')`,
      [organizationId, days],
    );
    log('retention.audit.dry_run', { organizationId, days, would_delete: probe.rows[0].n });
    return probe.rows[0].n;
  }
  const result = await client.query(
    `DELETE FROM audit_log
      WHERE organization_id = $1
        AND created_at < NOW() - ($2::int * interval '1 day')`,
    [organizationId, days],
  );
  log('retention.audit.applied', { organizationId, days, deleted: result.rowCount });
  return result.rowCount;
}

async function main() {
  const tenant = await loadTenantPolicy();
  const orgs = await loadOrgPolicies();

  if (!tenant && orgs.length === 0) {
    log('retention.skipped', { reason: 'no policies configured' });
    return;
  }

  // 1) Per-org policies — each org transactionally so a single failure
  //    can't cascade into another tenant.
  for (const org of orgs) {
    if (!org.transcriptionDays && !org.auditDays) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (org.transcriptionDays) {
        await expireOrgTranscriptions(client, org.organizationId, org.transcriptionDays);
      }
      if (org.auditDays) {
        await expireOrgAudit(client, org.organizationId, org.auditDays);
      }
      await client.query(DRY_RUN ? 'ROLLBACK' : 'COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      log('retention.org.failed', { organizationId: org.organizationId, error: error.message });
    } finally {
      client.release();
    }
  }

  // 2) Tenant-wide fallback — only catches rows where no org override exists.
  if (tenant) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expireFallbackTranscriptions(client, tenant.transcriptionDays);
      await client.query(DRY_RUN ? 'ROLLBACK' : 'COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      log('retention.fallback.failed', { error: error.message });
    } finally {
      client.release();
    }
  }

  log('retention.completed', {
    orgs: orgs.length,
    tenantFallback: !!tenant,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
