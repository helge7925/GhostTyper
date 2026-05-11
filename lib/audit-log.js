import { query } from './db';
import { logError, pseudonymizeEmail } from './observability';

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

// M8 (cybersecurity-audit-2026-05-09): pseudonymise PII in audit_log
// metadata before a user is deleted. The audit_log.user_id FK already
// goes to NULL via ON DELETE SET NULL, but the metadata JSONB still
// holds plaintext email / name fields from invite, role-change and
// settings-update events. Replacing those with a stable email-hash
// satisfies GDPR Art. 17 ("right to be forgotten") while preserving
// the audit trail's investigative value.
//
// Pseudonymises both `where user_id = $1` (events the user *did*) and
// `where target_id = $1::text and target_type = 'user'` (events done
// *to* the user). Idempotent: applying it twice produces the same
// final state.
const PII_FIELD_KEYS = new Set([
  'email',
  'userEmail',
  'targetEmail',
  'inviteeEmail',
  'inviterEmail',
  'fromEmail',
  'toEmail',
]);
const PII_NAME_KEYS = new Set(['name', 'displayName', 'inviterName', 'inviteeName']);

function pseudonymizeAuditMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return metadata || {};
  }
  const out = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (PII_FIELD_KEYS.has(k) && typeof v === 'string') {
      out[k] = pseudonymizeEmail(v) || '[redacted]';
      continue;
    }
    if (PII_NAME_KEYS.has(k) && typeof v === 'string') {
      out[k] = '[redacted]';
      continue;
    }
    out[k] = v;
  }
  return out;
}

export async function pseudonymizeUserAuditTrail(userId) {
  if (!userId) return { rows: 0 };
  const userIdStr = String(userId);
  let rowsTouched = 0;
  try {
    const result = await query(
      `SELECT id, metadata FROM audit_log
        WHERE user_id = $1
           OR (target_type = 'user' AND target_id = $2)`,
      [userId, userIdStr],
    );
    for (const row of result.rows) {
      const next = pseudonymizeAuditMetadata(row.metadata);
      await query(
        'UPDATE audit_log SET metadata = $2::jsonb WHERE id = $1',
        [row.id, JSON.stringify(next)],
      );
      rowsTouched += 1;
    }
  } catch (error) {
    if (error?.code === '42P01' || error?.code === '42703') return { rows: 0 };
    logError('audit_log.pseudonymize_failed', error, { userId });
    throw error;
  }
  return { rows: rowsTouched };
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
