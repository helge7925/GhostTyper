import { query } from '../../../lib/db';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { hasPermission, ROLES } from '../../../lib/permissions';
import { logAuditEvent } from '../../../lib/audit-log';

async function handler(req, res) {
  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'org-members',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'GET': {
      try {
        // Join settings (per-user) + this month's usage so the workspace
        // admin sees everything the global /admin/users sees — scoped to
        // the active org and updated live whenever a user's row changes.
        const result = await query(
          `SELECT u.id, u.email, u.name, u.avatar_url,
                  m.role, m.joined_at,
                  (s.mistral_api_key IS NOT NULL OR s.mistral_api_key_encrypted IS NOT NULL) AS api_key_configured,
                  s.cost_limit AS personal_cost_limit,
                  s.member_monthly_budget_limit AS personal_member_budget_limit,
                  COALESCE(usage.total_cost, 0) AS month_cost
             FROM organization_members m
             JOIN users u ON u.id = m.user_id
        LEFT JOIN settings s ON s.user_id = u.id
        LEFT JOIN (
                SELECT user_id, SUM(estimated_cost)::float AS total_cost
                  FROM usage_log
                 WHERE organization_id = $1
                   AND created_at >= date_trunc('month', NOW())
                 GROUP BY user_id
              ) usage ON usage.user_id = u.id
            WHERE m.organization_id = $1
            ORDER BY m.role = 'owner' DESC, m.role = 'admin' DESC, m.joined_at ASC`,
          [orgId],
        );
        return res.status(200).json({ members: result.rows });
      } catch (error) {
        logApiError('Org members list failed', error);
        return serverError(res, 'Mitglieder konnten nicht geladen werden.');
      }
    }

    case 'PATCH': {
      if (!hasPermission(req.role, 'org.members.write')) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung für Mitgliederverwaltung.' });
      }
      const { memberUserId, role } = req.body || {};
      const targetUserId = Number(memberUserId);
      if (!Number.isFinite(targetUserId) || !ROLES.includes(role)) {
        return res.status(400).json({ message: 'Ungültige Eingabe.' });
      }
      // Only owners can grant the owner role.
      if (req.role !== 'owner' && role === 'owner') {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Owner-Rolle kann nur ein Owner vergeben.' });
      }
      // Prevent demoting the last owner of the workspace. We need the
      // target's current role; if they are the only owner and the new
      // role is not 'owner', reject.
      if (role !== 'owner') {
        const target = await query(
          `SELECT role FROM organization_members
             WHERE organization_id = $1 AND user_id = $2`,
          [orgId, targetUserId],
        );
        if (target.rows[0]?.role === 'owner') {
          const remaining = await query(
            `SELECT COUNT(*)::int AS n FROM organization_members
               WHERE organization_id = $1 AND role = 'owner' AND user_id != $2`,
            [orgId, targetUserId],
          );
          if ((remaining.rows[0]?.n || 0) === 0) {
            return res.status(400).json({
              message: 'Mindestens ein Owner muss im Workspace verbleiben.',
            });
          }
        }
      }
      try {
        const result = await query(
          `UPDATE organization_members SET role = $1
             WHERE organization_id = $2 AND user_id = $3
             RETURNING role`,
          [role, orgId, targetUserId],
        );
        if (result.rowCount === 0) {
          return res.status(404).json({ message: 'Mitglied nicht gefunden.' });
        }
        await logAuditEvent({
          userId,
          organizationId: orgId,
          action: 'org.member.role_changed',
          targetType: 'user',
          targetId: String(targetUserId),
          metadata: { newRole: role },
        });
        return res.status(200).json({ ok: true });
      } catch (error) {
        logApiError('Org member role change failed', error);
        return serverError(res, 'Rollenänderung fehlgeschlagen.');
      }
    }

    case 'DELETE': {
      if (!hasPermission(req.role, 'org.members.write')) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung für Mitgliederverwaltung.' });
      }
      const targetUserId = Number(req.query.userId);
      if (!Number.isFinite(targetUserId)) {
        return res.status(400).json({ message: 'userId fehlt.' });
      }
      if (targetUserId === userId) {
        return res.status(400).json({ message: 'Sie können sich nicht selbst entfernen.' });
      }
      try {
        // Prevent removal of the last remaining owner.
        const target = await query(
          `SELECT role FROM organization_members
             WHERE organization_id = $1 AND user_id = $2`,
          [orgId, targetUserId],
        );
        if (target.rows[0]?.role === 'owner') {
          const remaining = await query(
            `SELECT COUNT(*)::int AS n FROM organization_members
               WHERE organization_id = $1 AND role = 'owner' AND user_id != $2`,
            [orgId, targetUserId],
          );
          if ((remaining.rows[0]?.n || 0) === 0) {
            return res.status(400).json({
              message: 'Mindestens ein Owner muss im Workspace verbleiben.',
            });
          }
        }

        const result = await query(
          'DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2 RETURNING role',
          [orgId, targetUserId],
        );
        if (result.rowCount === 0) {
          return res.status(404).json({ message: 'Mitglied nicht gefunden.' });
        }
        await logAuditEvent({
          userId,
          organizationId: orgId,
          action: 'org.member.removed',
          targetType: 'user',
          targetId: String(targetUserId),
          severity: 'warn',
        });
        return res.status(200).json({ ok: true });
      } catch (error) {
        logApiError('Org member remove failed', error);
        return serverError(res, 'Mitglied konnte nicht entfernt werden.');
      }
    }

    default:
      res.setHeader('Allow', ['GET', 'PATCH', 'DELETE']);
      return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
}

export default withOrgScope({ permission: 'org.members.read' }, handler);
