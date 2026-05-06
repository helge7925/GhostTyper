import { query } from '../../../../lib/db';
import { enforceRateLimit, logApiError } from '../../../../lib/api-utils';
import { withOrgScope } from '../../../../lib/api/with-org-scope';
import { hasPermission } from '../../../../lib/permissions';
import { logAuditEvent } from '../../../../lib/audit-log';
import { addTranscriptionEvent } from '../../../../lib/transcription-events';
import { mintShareToken, revokeShareToken } from '../../../../lib/share-tokens';
import { ensureShareLinkPostedToChat } from '../../../../lib/share-chat-poster';

/**
 * Manage the public share-link for the live-translation companion view.
 *
 *   POST   { enabled: true }   → mint or rotate a token, return URL + expiry
 *   POST   { enabled: false }  → revoke the token, future requests 404
 *   GET                        → return current token state (no token to client
 *                                 unless caller has meeting.start permission)
 *
 * The token grants read-only access to the translation columns of this
 * one row — see `lib/share-tokens.js` for the full scope contract.
 *
 * Only owners + workspace admins can mint/revoke; anyone with
 * `transcription.read` can check whether a share is currently active.
 */
async function handler(req, res) {
  const orgId = req.org.id;
  const userId = req.userId;
  const transcriptionId = Number(req.query.id);
  if (!Number.isFinite(transcriptionId)) {
    return res.status(400).json({ code: 'INVALID_ID' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'meeting-share',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!allowed) return;

  // Confirm the row + ownership.
  const row = await query(
    `SELECT user_id, source, public_share_token, public_share_expires_at
       FROM transcriptions
      WHERE id = $1 AND organization_id = $2`,
    [transcriptionId, orgId],
  );
  if (!row.rows.length) return res.status(404).json({ code: 'NOT_FOUND' });
  const meta = row.rows[0];
  if (meta.source !== 'vexa') return res.status(400).json({ code: 'NOT_A_MEETING' });
  const isOwner = String(meta.user_id) === String(userId);
  const canManage = isOwner || hasPermission(req.role, 'meeting.start');

  switch (req.method) {
    case 'GET': {
      // Owners + admins see the active token (so the share UI can
      // show the URL even after a page reload). Other readers only
      // get a boolean — useful so the UI can reflect "share is on"
      // without leaking the URL itself.
      const isActive = !!meta.public_share_token
        && meta.public_share_expires_at
        && new Date(meta.public_share_expires_at).getTime() > Date.now();
      if (canManage) {
        return res.status(200).json({
          active: isActive,
          token: isActive ? meta.public_share_token : null,
          expiresAt: isActive ? meta.public_share_expires_at : null,
        });
      }
      return res.status(200).json({ active: isActive });
    }

    case 'POST': {
      if (!canManage) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
      }
      const wantEnabled = req.body?.enabled === true;
      const postToChat = req.body?.postToChat !== false; // default true
      try {
        if (wantEnabled) {
          const ttlHours = Number(req.body?.ttlHours) > 0 && Number(req.body?.ttlHours) <= 168
            ? Number(req.body.ttlHours)
            : 24;
          const result = await mintShareToken({ transcriptionId, organizationId: orgId, ttlHours });

          // Reset the idempotency stamp so this newly-minted token
          // gets posted into chat — the previous token (if any) is
          // dead, so re-posting is exactly what we want.
          await query(
            `UPDATE transcriptions SET share_link_posted_at = NULL WHERE id = $1`,
            [transcriptionId],
          );

          await addTranscriptionEvent({
            transcriptionId,
            userId,
            organizationId: orgId,
            stage: 'share_enabled',
            message: `Public Share-Link aktiviert (gültig ${ttlHours} h).`,
          });
          await logAuditEvent({
            userId,
            organizationId: orgId,
            action: 'meeting.bot.share.enable',
            targetType: 'transcription',
            targetId: String(transcriptionId),
            metadata: { ttlHours, expiresAt: result.expiresAt },
          });

          // Best-effort chat-post. Failure here doesn't fail the API
          // call; the host always sees the URL in the UI and can
          // copy/paste manually.
          let chatPostResult = null;
          if (postToChat) {
            try {
              chatPostResult = await ensureShareLinkPostedToChat({
                transcriptionId,
                organizationId: orgId,
              });
            } catch (error) {
              logApiError('share-toggle chat post failed', error, { transcriptionId, orgId });
              chatPostResult = { posted: false, reason: 'exception' };
            }
          }

          return res.status(200).json({
            active: true,
            token: result.token,
            expiresAt: result.expiresAt,
            chatPosted: !!chatPostResult?.posted,
            chatPostReason: chatPostResult?.reason || null,
          });
        }

        await revokeShareToken({ transcriptionId, organizationId: orgId });
        await addTranscriptionEvent({
          transcriptionId,
          userId,
          organizationId: orgId,
          stage: 'share_disabled',
          message: 'Public Share-Link deaktiviert.',
        });
        await logAuditEvent({
          userId,
          organizationId: orgId,
          action: 'meeting.bot.share.disable',
          targetType: 'transcription',
          targetId: String(transcriptionId),
          metadata: {},
        });
        return res.status(200).json({ active: false, token: null, expiresAt: null });
      } catch (error) {
        logApiError('Meeting share update failed', error, { transcriptionId, orgId });
        return res.status(500).json({ code: 'UPDATE_FAILED' });
      }
    }

    default:
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
}

export default withOrgScope({ permission: 'transcription.read' }, handler);
