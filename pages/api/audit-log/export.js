import { query } from '../../../lib/db';
import { logAuditEvent } from '../../../lib/audit-log';
import { buildAuditExportPackage } from '../../../lib/audit-export';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError } from '../../../lib/api-utils';

const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
const MAX_ROWS = 5000;

export function parseAuditExportRange(queryParams, now = new Date()) {
  const until = queryParams.until ? new Date(String(queryParams.until)) : now;
  const since = queryParams.since
    ? new Date(String(queryParams.since))
    : new Date(until.valueOf() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(since.valueOf()) || Number.isNaN(until.valueOf()) || since > until) {
    throw new Error('INVALID_DATE_RANGE');
  }
  if (until - since > MAX_RANGE_MS) throw new Error('DATE_RANGE_TOO_LARGE');
  return { since, until };
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: 'Method not allowed' });
  }
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'audit-export',
    identifier: `org:${req.org.id}:user:${req.userId}`,
    limit: 5,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    const range = parseAuditExportRange(req.query);
    if (req.query.action || req.query.severity) {
      return res.status(400).json({
        code: 'FILTERED_CHAIN_NOT_SUPPORTED',
        message: 'Signierte Exporte unterstützen nur zusammenhängende Zeiträume.',
      });
    }
    const result = await query(
      `SELECT id, organization_id, user_id, action, target_type, target_id, severity,
              metadata, created_at, prev_hash, entry_hash
         FROM audit_log
        WHERE organization_id = $1
          AND created_at >= $2 AND created_at <= $3
        ORDER BY id ASC
        LIMIT $4`,
      [req.org.id, range.since.toISOString(), range.until.toISOString(), MAX_ROWS + 1],
    );
    if (result.rows.length > MAX_ROWS) {
      return res.status(413).json({ code: 'AUDIT_EXPORT_TOO_LARGE', maxRows: MAX_ROWS });
    }
    const built = await buildAuditExportPackage({
      events: result.rows,
      organization: req.org,
      range,
    });
    await logAuditEvent({
      userId: req.userId,
      organizationId: req.org.id,
      action: 'audit.export',
      targetType: 'audit_log',
      severity: 'info',
      metadata: {
        since: range.since.toISOString(), until: range.until.toISOString(),
        rows: result.rows.length, signed: built.manifest.signed,
      },
    });
    const date = new Date().toISOString().slice(0, 10);
    const slug = String(req.org.slug || 'organization').replace(/[^a-z0-9_-]/gi, '-');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="audit-${slug}-${date}.zip"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(built.buffer);
  } catch (error) {
    if (error.message === 'INVALID_DATE_RANGE' || error.message === 'DATE_RANGE_TOO_LARGE') {
      return res.status(400).json({ code: error.message, message: 'Ungültiger Export-Zeitraum.' });
    }
    if (error.message === 'AUDIT_EXPORT_TOO_LARGE') {
      return res.status(413).json({ code: error.message, message: 'Audit-Export ist zu groß.' });
    }
    if (error.message === 'AUDIT_CHAIN_INVALID') {
      return res.status(409).json({ code: error.message, message: 'Die Audit-Kette ist nicht valide.' });
    }
    logApiError('Audit export failed', error);
    return res.status(500).json({ message: 'Audit-Export fehlgeschlagen.' });
  }
}

export default withOrgScope({ permission: 'audit.export' }, handler);
