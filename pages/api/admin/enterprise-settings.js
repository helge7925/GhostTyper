import { requireAdmin } from '../../../lib/admin';
import { query } from '../../../lib/db';
import { enforceRateLimit, logApiError } from '../../../lib/api-utils';
import { logAuditEvent } from '../../../lib/audit-log';

const SETTINGS_KEY = 'retention_policy';

function normalizeRetentionDays(value) {
  if (value === null || value === '' || value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 3650) return null;
  return parsed;
}

export default async function handler(req, res) {
  const session = await requireAdmin(req, res);
  if (!session) return;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'admin-enterprise-settings',
    identifier: `admin:${session.user.id}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    if (req.method === 'GET') {
      const result = await query(
        'SELECT value, updated_at FROM enterprise_settings WHERE key = $1',
        [SETTINGS_KEY]
      );
      const value = result.rows[0]?.value || {};
      return res.status(200).json({
        retentionDays: value.retentionDays ?? null,
        updatedAt: result.rows[0]?.updated_at || null,
      });
    }

    if (req.method === 'PUT') {
      const retentionDays = normalizeRetentionDays(req.body?.retentionDays);
      const enabled = retentionDays !== null && req.body?.enabled !== false;
      const value = {
        enabled,
        retentionDays: enabled ? retentionDays : null,
      };

      await query(
        `INSERT INTO enterprise_settings (key, value, updated_by, updated_at)
         VALUES ($1, $2::jsonb, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [SETTINGS_KEY, JSON.stringify(value), session.user.id]
      );
      await logAuditEvent({
        userId: session.user.id,
        action: 'enterprise_settings.retention.updated',
        targetType: 'enterprise_settings',
        targetId: SETTINGS_KEY,
        metadata: value,
      });
      return res.status(200).json(value);
    }

    return res.status(405).json({ message: 'Method not allowed' });
  } catch (error) {
    if (error?.code === '42P01' || error?.code === '42703') {
      return res.status(503).json({ message: 'Datenbank-Schema ist veraltet. Bitte DB-Init ausführen.' });
    }
    logApiError('Enterprise settings API error', error);
    return res.status(500).json({ message: 'Enterprise-Einstellungen konnten nicht geladen werden' });
  }
}
