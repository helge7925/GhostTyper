import { query } from './db';
import { logError } from './observability';

function safeText(value, maxLength) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function safeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

export async function logAuditEvent({
  userId = null,
  organizationId = null,
  action,
  targetType = null,
  targetId = null,
  severity = 'info',
  metadata = {},
}) {
  const normalizedAction = safeText(action, 120);
  if (!normalizedAction) return;

  try {
    await query(
      `INSERT INTO audit_log (user_id, organization_id, action, target_type, target_id, severity, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        userId || null,
        organizationId || null,
        normalizedAction,
        safeText(targetType, 80),
        safeText(targetId, 160),
        safeText(severity, 20) || 'info',
        JSON.stringify(safeMetadata(metadata)),
      ]
    );
  } catch (error) {
    // Keep app flow resilient while schema migrations are rolling out.
    if (error?.code !== '42P01' && error?.code !== '42703') {
      logError('audit_log.write_failed', error, { action: normalizedAction, userId, organizationId });
    }
  }
}

export async function listAuditEventsForUser(userId, limit = 80) {
  const maxRows = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 80));
  const result = await query(
    `SELECT id, action, target_type, target_id, severity, metadata, created_at
     FROM audit_log
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, maxRows]
  );
  return result.rows;
}

/**
 * List audit events scoped to an organisation. Used by the new audit page
 * (read access via `audit.read` permission); includes the optional cross-
 * filters action / severity / since / until for the UI filter panel.
 */
export async function listAuditEventsForOrg(organizationId, options = {}) {
  const maxRows = Math.min(500, Math.max(1, Number.parseInt(options.limit, 10) || 80));
  const conditions = ['organization_id = $1'];
  const params = [organizationId];

  if (options.action) {
    params.push(options.action);
    conditions.push(`action = $${params.length}`);
  }
  if (options.severity) {
    params.push(options.severity);
    conditions.push(`severity = $${params.length}`);
  }
  if (options.since instanceof Date && !Number.isNaN(options.since.valueOf())) {
    params.push(options.since.toISOString());
    conditions.push(`created_at >= $${params.length}`);
  }
  if (options.until instanceof Date && !Number.isNaN(options.until.valueOf())) {
    params.push(options.until.toISOString());
    conditions.push(`created_at <= $${params.length}`);
  }

  params.push(maxRows);
  const result = await query(
    `SELECT id, user_id, action, target_type, target_id, severity, metadata, created_at
       FROM audit_log
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return result.rows;
}

export async function listAuditEvents(limit = 80) {
  const maxRows = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 80));
  const result = await query(
    `SELECT id, user_id, action, target_type, target_id, severity, metadata, created_at
     FROM audit_log
     ORDER BY created_at DESC
     LIMIT $1`,
    [maxRows]
  );
  return result.rows;
}
