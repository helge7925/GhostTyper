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
      `INSERT INTO audit_log (user_id, action, target_type, target_id, severity, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        userId || null,
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
      logError('audit_log.write_failed', error, { action: normalizedAction, userId });
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
