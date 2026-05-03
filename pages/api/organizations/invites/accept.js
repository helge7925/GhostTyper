import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';
import { query } from '../../../../lib/db';
import { enforceRateLimit, logApiError, serverError } from '../../../../lib/api-utils';
import { logAuditEvent } from '../../../../lib/audit-log';
import { ROLES } from '../../../../lib/permissions';

/**
 * POST /api/organizations/invites/accept
 * Body: { token: string }
 *
 * Auth-required. Validates the token, checks that the invite hasn't expired
 * or been accepted, optionally cross-checks the e-mail against the logged-in
 * user, and inserts the membership row. Idempotent: re-accepting an already
 * accepted invite returns 200 with the same membership.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    return res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Bitte anmelden, um die Einladung anzunehmen.' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'org-invite-accept',
    identifier: `user:${session.user.id}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token) {
    return res.status(400).json({ code: 'INVALID_TOKEN', message: 'Token fehlt.' });
  }

  try {
    const inviteResult = await query(
      `SELECT id, organization_id, email, role, expires_at, accepted_at
         FROM organization_invites
        WHERE token = $1`,
      [token],
    );
    const invite = inviteResult.rows[0];

    if (!invite) {
      return res.status(404).json({ code: 'INVITE_NOT_FOUND', message: 'Einladung nicht gefunden.' });
    }

    if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now() && !invite.accepted_at) {
      return res.status(410).json({ code: 'INVITE_EXPIRED', message: 'Diese Einladung ist abgelaufen.' });
    }

    // Optional e-mail check — if the e-mail is set, only that user may
    // accept. We do a case-insensitive comparison.
    if (invite.email && session.user.email) {
      if (invite.email.toLowerCase() !== String(session.user.email).toLowerCase()) {
        return res.status(403).json({
          code: 'INVITE_EMAIL_MISMATCH',
          message: 'Diese Einladung wurde an eine andere E-Mail-Adresse versendet.',
        });
      }
    }

    if (!ROLES.includes(invite.role)) {
      return res.status(400).json({ code: 'INVALID_ROLE', message: 'Ungültige Rolle in der Einladung.' });
    }

    // Insert membership (idempotent thanks to the composite PK).
    await query(
      `INSERT INTO organization_members (organization_id, user_id, role, invited_by)
       VALUES ($1, $2, $3, NULL)
       ON CONFLICT (organization_id, user_id) DO NOTHING`,
      [invite.organization_id, session.user.id, invite.role],
    );

    if (!invite.accepted_at) {
      await query(
        'UPDATE organization_invites SET accepted_at = NOW() WHERE id = $1',
        [invite.id],
      );
    }

    await logAuditEvent({
      userId: session.user.id,
      organizationId: invite.organization_id,
      action: 'org.invite.accepted',
      targetType: 'invite',
      targetId: String(invite.id),
      metadata: { role: invite.role },
    });

    return res.status(200).json({
      ok: true,
      organizationId: invite.organization_id,
      role: invite.role,
      // Hint for the client: trigger session.update({ currentOrganizationId })
      // after this response so the new workspace becomes active.
      switchTo: invite.organization_id,
    });
  } catch (error) {
    logApiError('Org invite accept failed', error);
    return serverError(res, 'Einladung konnte nicht angenommen werden.');
  }
}
