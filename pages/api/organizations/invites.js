import { randomBytes } from 'crypto';
import { query } from '../../../lib/db';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { hasPermission, ROLES } from '../../../lib/permissions';
import { logAuditEvent } from '../../../lib/audit-log';
import { sendInviteEmail, buildInviteUrl } from '../../../lib/email-invites';

const INVITE_TTL_DAYS = 14;

function generateInviteToken() {
  return randomBytes(24).toString('hex');
}

async function handler(req, res) {
  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'org-invites',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'GET': {
      try {
        const result = await query(
          `SELECT id, email, role, expires_at, accepted_at, created_at
             FROM organization_invites
            WHERE organization_id = $1
            ORDER BY created_at DESC`,
          [orgId],
        );
        return res.status(200).json({ invites: result.rows });
      } catch (error) {
        logApiError('Org invites list failed', error);
        return serverError(res, 'Einladungen konnten nicht geladen werden.');
      }
    }

    case 'POST': {
      if (!hasPermission(req.role, 'org.invites.create')) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung zum Einladen.' });
      }
      const { email, role = 'member' } = req.body || {};
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ message: 'E-Mail ist ungültig.' });
      }
      if (!ROLES.includes(role)) {
        return res.status(400).json({ message: 'Ungültige Rolle.' });
      }
      if (role === 'owner' && req.role !== 'owner') {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Owner-Rolle kann nur ein Owner vergeben.' });
      }
      try {
        const token = generateInviteToken();
        const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
        const result = await query(
          `INSERT INTO organization_invites (organization_id, email, role, token, invited_by, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, email, role, expires_at, created_at`,
          [orgId, normalizedEmail, role, token, userId, expiresAt],
        );

        // Best-effort dispatch; never fails the invite creation if the
        // provider hook isn't wired (we still return the URL so admins can
        // copy the link manually).
        let mail;
        try {
          mail = await sendInviteEmail({
            to: normalizedEmail,
            organizationName: req.org.name,
            inviterName: null,
            role,
            token,
            expiresAt,
          });
        } catch (mailError) {
          logApiError('Org invite mail dispatch failed', mailError);
          mail = { delivered: false, url: buildInviteUrl(token) };
        }

        await logAuditEvent({
          userId,
          organizationId: orgId,
          action: 'org.invite.created',
          targetType: 'invite',
          targetId: String(result.rows[0].id),
          metadata: { email: normalizedEmail, role, delivered: !!mail?.delivered },
        });
        return res.status(201).json({
          invite: result.rows[0],
          inviteUrl: mail?.url ?? buildInviteUrl(token),
          delivered: !!mail?.delivered,
        });
      } catch (error) {
        logApiError('Org invite create failed', error);
        return serverError(res, 'Einladung konnte nicht erstellt werden.');
      }
    }

    case 'DELETE': {
      if (!hasPermission(req.role, 'org.invites.create')) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
      }
      const inviteId = Number(req.query.id);
      if (!Number.isFinite(inviteId)) {
        return res.status(400).json({ message: 'id fehlt.' });
      }
      try {
        const result = await query(
          'DELETE FROM organization_invites WHERE id = $1 AND organization_id = $2 RETURNING id',
          [inviteId, orgId],
        );
        if (result.rowCount === 0) {
          return res.status(404).json({ message: 'Einladung nicht gefunden.' });
        }
        await logAuditEvent({
          userId,
          organizationId: orgId,
          action: 'org.invite.revoked',
          targetType: 'invite',
          targetId: String(inviteId),
          severity: 'warn',
        });
        return res.status(200).json({ ok: true });
      } catch (error) {
        logApiError('Org invite revoke failed', error);
        return serverError(res, 'Einladung konnte nicht zurückgezogen werden.');
      }
    }

    default:
      res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
      return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
}

export default withOrgScope({ permission: 'org.members.read' }, handler);
