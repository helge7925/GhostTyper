import { query } from '../../../../../lib/db';
import { enforceRateLimit, logApiError, serverError } from '../../../../../lib/api-utils';
import { withOrgScope } from '../../../../../lib/api/with-org-scope';
import { hasPermission } from '../../../../../lib/permissions';
import { logAuditEvent } from '../../../../../lib/audit-log';

async function handler(req, res) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', ['PATCH']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  if (!hasPermission(req.role, 'org.members.write')) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung für Mitgliederverwaltung.' });
  }

  const orgId = req.org.id;
  const adminUserId = req.userId;
  const targetUserId = Number(req.query.userId);
  if (!Number.isFinite(targetUserId)) {
    return res.status(400).json({ message: 'userId fehlt.' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'org-member-settings',
    identifier: `org:${orgId}:user:${adminUserId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  // Verify the target is actually a member of the active org. Without this
  // check a workspace admin could modify settings of users in other orgs.
  const memberCheck = await query(
    'SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2',
    [orgId, targetUserId],
  );
  if (memberCheck.rowCount === 0) {
    return res.status(404).json({ message: 'Mitglied gehört nicht zu diesem Workspace.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const updates = [];
  const values = [];
  const meta = {};

  if (Object.prototype.hasOwnProperty.call(body, 'personalCostLimit')) {
    const v = body.personalCostLimit;
    if (v === null || v === '') {
      values.push(null);
      updates.push(`cost_limit = $${values.length}`);
      meta.cost_limit = null;
    } else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ message: 'Ungültiges Kostenlimit.' });
      }
      values.push(n);
      updates.push(`cost_limit = $${values.length}`);
      meta.cost_limit = n;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'personalMemberBudgetLimit')) {
    const v = body.personalMemberBudgetLimit;
    if (v === null || v === '') {
      values.push(null);
      updates.push(`member_monthly_budget_limit = $${values.length}`);
      meta.member_monthly_budget_limit = null;
    } else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ message: 'Ungültiges Mitglieder-Budgetlimit.' });
      }
      values.push(n);
      updates.push(`member_monthly_budget_limit = $${values.length}`);
      meta.member_monthly_budget_limit = n;
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ code: 'NO_FIELDS', message: 'Keine Felder zum Aktualisieren.' });
  }

  try {
    values.push(targetUserId);
    // Upsert: ensures a settings row exists for users that never opened the
    // settings page themselves, then applies the requested changes.
    await query(
      `INSERT INTO settings (user_id) VALUES ($${values.length})
         ON CONFLICT (user_id) DO NOTHING`,
      [targetUserId],
    );
    await query(
      `UPDATE settings SET ${updates.join(', ')}, updated_at = NOW() WHERE user_id = $${values.length}`,
      values,
    );
    await logAuditEvent({
      userId: adminUserId,
      organizationId: orgId,
      action: 'org.member.settings_updated',
      targetType: 'user',
      targetId: String(targetUserId),
      metadata: meta,
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    logApiError('Org member settings update failed', error);
    return serverError(res, 'Mitglieder-Einstellungen konnten nicht aktualisiert werden.');
  }
}

export default withOrgScope({ permission: 'org.members.read' }, handler);
