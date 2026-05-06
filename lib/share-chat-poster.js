import { query } from './db';
import { resolveVexaConfig } from './integrations';
import { decryptSecret } from './secrets';
import { sendBotChatMessage } from './api/vexa';
import { mintShareToken, buildShareUrl, buildShareChatMessage } from './share-tokens';
import { addTranscriptionEvent } from './transcription-events';
import { logError, logInfo } from './observability';

/**
 * Idempotent helper: post the live-translation share-link into the
 * meeting chat via the Vexa bot.
 *
 * Triggers from two places:
 *   1. `pages/api/webhooks/vexa.js` on `meeting.started` — auto-post
 *      when the user enabled translation+share at meeting start.
 *   2. `pages/api/meetings/[id]/share.js` POST {enabled:true} — when
 *      the host flips the share toggle mid-meeting.
 *
 * Idempotency is enforced via `share_link_posted_at`: once set we
 * never re-post for the same row even if the caller asks again. To
 * post a fresh message after revoke→re-enable, the caller can clear
 * the column first.
 *
 * Failures are swallowed with structured logs — this helper must
 * never break the surrounding flow (the share-link itself is still
 * valid, the user can copy/paste manually if the chat-post fails).
 */
export async function ensureShareLinkPostedToChat({
  transcriptionId,
  organizationId,
  forceRepost = false,
} = {}) {
  let row;
  try {
    const result = await query(
      `SELECT id, user_id, organization_id, source, status,
              meeting_platform, native_meeting_id,
              translation_config, public_share_token, public_share_expires_at,
              share_link_posted_at
         FROM transcriptions
        WHERE id = $1`,
      [transcriptionId],
    );
    row = result.rows[0];
  } catch (error) {
    logError('share_chat_poster.row_lookup_failed', error, { transcriptionId });
    return { posted: false, reason: 'row_lookup_failed' };
  }
  if (!row) return { posted: false, reason: 'row_not_found' };
  if (organizationId && String(row.organization_id) !== String(organizationId)) {
    return { posted: false, reason: 'wrong_org' };
  }
  if (row.source !== 'vexa') return { posted: false, reason: 'not_a_meeting' };

  // Don't post on completed/error meetings.
  if (!['pending', 'processing'].includes(row.status)) {
    return { posted: false, reason: `status=${row.status}` };
  }

  const cfg = row.translation_config || {};
  if (!cfg.enabled) return { posted: false, reason: 'translation_disabled' };

  if (!forceRepost && row.share_link_posted_at) {
    return { posted: false, reason: 'already_posted' };
  }
  if (!row.public_share_token) {
    return { posted: false, reason: 'no_share_token' };
  }
  if (!row.public_share_expires_at || new Date(row.public_share_expires_at).getTime() <= Date.now()) {
    return { posted: false, reason: 'share_token_expired' };
  }

  // Resolve the per-org Vexa config + the bot owner's user-token.
  let baseUrl;
  let apiKey;
  try {
    const integration = await resolveVexaConfig(row.organization_id);
    if (!integration.enabled || !integration.config?.baseUrl) {
      return { posted: false, reason: 'integration_disabled' };
    }
    baseUrl = integration.config.baseUrl;

    const tokenRow = await query(
      `SELECT api_key_encrypted FROM vexa_user_tokens
        WHERE user_id = $1 AND organization_id = $2`,
      [row.user_id, row.organization_id],
    );
    if (!tokenRow.rows.length) return { posted: false, reason: 'no_user_token' };
    apiKey = decryptSecret(tokenRow.rows[0].api_key_encrypted);
    if (!apiKey) return { posted: false, reason: 'token_decrypt_failed' };
  } catch (error) {
    logError('share_chat_poster.config_lookup_failed', error, { transcriptionId });
    return { posted: false, reason: 'config_lookup_failed' };
  }

  const url = buildShareUrl(row.public_share_token);
  const message = buildShareChatMessage({
    url,
    fromLang: cfg.fromLang,
    toLang: cfg.toLang,
  });

  try {
    await sendBotChatMessage(
      { baseUrl, apiKey },
      {
        platform: row.meeting_platform,
        nativeMeetingId: row.native_meeting_id,
        text: message,
      },
    );
  } catch (error) {
    // Most common cause: bot hasn't fully joined yet, or the platform
    // doesn't expose a chat surface for non-host bots. We log and let
    // the host fall back to copy-paste.
    logError('share_chat_poster.send_failed', error, {
      transcriptionId,
      platform: row.meeting_platform,
    });
    return { posted: false, reason: 'send_failed', error: error.message };
  }

  await query(
    `UPDATE transcriptions SET share_link_posted_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [transcriptionId],
  );

  await addTranscriptionEvent({
    transcriptionId,
    userId: row.user_id,
    organizationId: row.organization_id,
    stage: 'share_link_posted',
    message: `Übersetzungs-Link automatisch im Meeting-Chat gepostet.`,
  });
  logInfo('share_chat_poster.posted', { transcriptionId });
  return { posted: true };
}

/**
 * Helper to mint a share-token if the row doesn't have one yet.
 * Used by POST /api/meetings (meeting start) when translation is
 * enabled — we want the share-token ready before the bot joins so
 * the webhook auto-post can use it.
 */
export async function ensureShareTokenForRow({ transcriptionId, organizationId, ttlHours = 24 }) {
  const result = await query(
    `SELECT public_share_token, public_share_expires_at FROM transcriptions
      WHERE id = $1 AND organization_id = $2`,
    [transcriptionId, organizationId],
  );
  if (!result.rows.length) return null;
  const row = result.rows[0];
  if (
    row.public_share_token
    && row.public_share_expires_at
    && new Date(row.public_share_expires_at).getTime() > Date.now()
  ) {
    return { token: row.public_share_token, expiresAt: row.public_share_expires_at };
  }
  return mintShareToken({ transcriptionId, organizationId, ttlHours });
}
