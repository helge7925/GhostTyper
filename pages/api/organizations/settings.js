import { query } from '../../../lib/db';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { hasPermission } from '../../../lib/permissions';
import { logAuditEvent } from '../../../lib/audit-log';

async function handler(req, res) {
  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'org-settings',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'GET': {
      try {
        const result = await query(
          `SELECT default_language, retention_days, cost_limit_cents, member_monthly_budget_limit_cents,
                  audit_retention_days, sso_config, updated_at
             FROM organization_settings
            WHERE organization_id = $1`,
          [orgId],
        );
        return res.status(200).json({
          organization: req.org,
          settings: result.rows[0] || null,
        });
      } catch (error) {
        logApiError('Org settings GET failed', error);
        return serverError(res, 'Workspace-Einstellungen konnten nicht geladen werden.');
      }
    }

    case 'PUT': {
      if (!hasPermission(req.role, 'org.settings')) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const {
        defaultLanguage = null,
        retentionDays = null,
        costLimitCents = null,
        memberMonthlyBudgetLimitCents = null,
        auditRetentionDays = null,
      } = body;

      try {
        await query(
          `INSERT INTO organization_settings
             (organization_id, default_language, retention_days, cost_limit_cents,
              member_monthly_budget_limit_cents, audit_retention_days, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (organization_id) DO UPDATE SET
             default_language = EXCLUDED.default_language,
             retention_days = EXCLUDED.retention_days,
             cost_limit_cents = EXCLUDED.cost_limit_cents,
             member_monthly_budget_limit_cents = EXCLUDED.member_monthly_budget_limit_cents,
             audit_retention_days = EXCLUDED.audit_retention_days,
             updated_at = NOW()`,
          [
            orgId,
            defaultLanguage || null,
            Number.isFinite(Number(retentionDays)) ? Number(retentionDays) : null,
            Number.isFinite(Number(costLimitCents)) ? Number(costLimitCents) : null,
            Number.isFinite(Number(memberMonthlyBudgetLimitCents)) ? Number(memberMonthlyBudgetLimitCents) : null,
            Number.isFinite(Number(auditRetentionDays)) ? Number(auditRetentionDays) : null,
          ],
        );
        await logAuditEvent({
          userId,
          organizationId: orgId,
          action: 'org.settings.updated',
          targetType: 'organization',
          targetId: String(orgId),
        });
        return res.status(200).json({ ok: true });
      } catch (error) {
        logApiError('Org settings PUT failed', error);
        return serverError(res, 'Workspace-Einstellungen konnten nicht gespeichert werden.');
      }
    }

    default:
      res.setHeader('Allow', ['GET', 'PUT']);
      return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
}

export default withOrgScope({ permission: 'org.read' }, handler);
