import { query } from './db';
import { resolveVexaConfig } from './integrations';
import { decryptSecret, SECRET_CONTEXTS } from './secrets';
import { setBotScreenContent, clearBotScreenContent } from './api/vexa';
import { buildShareUrl } from './share-tokens';
import { ensureShareTokenForRow } from './share-chat-poster';
import { addTranscriptionEvent } from './transcription-events';
import { logError, logInfo } from './observability';

/**
 * Idempotent helper for the in-meeting subtitle overlay.
 *
 * Triggered from the `meeting.started` webhook (and from the live
 * toggle in MeetingControlBar). Mints a share-token if needed, then
 * tells the Vexa bot to render the public `/share/[token]/overlay`
 * page on its webcam canvas. Once `overlay_started_at` is stamped we
 * never re-trigger for the same row — the page itself does the live
 * updates via SSE, no further API calls into Vexa needed.
 *
 * Twin pattern of `lib/share-chat-poster.js`: same defensive lookup,
 * same swallow-errors-don't-break-meeting-flow contract.
 */
export async function ensureOverlayStarted({
  transcriptionId,
  organizationId,
  forceRestart = false,
} = {}) {
  let row;
  try {
    const result = await query(
      `SELECT id, user_id, organization_id, source, status,
              meeting_platform, native_meeting_id,
              translation_config, in_meeting_overlay_enabled,
              public_share_token, public_share_expires_at,
              overlay_started_at
         FROM transcriptions
        WHERE id = $1`,
      [transcriptionId],
    );
    row = result.rows[0];
  } catch (error) {
    logError('overlay.row_lookup_failed', error, { transcriptionId });
    return { started: false, reason: 'row_lookup_failed' };
  }

  if (!row) return { started: false, reason: 'row_not_found' };
  if (organizationId && String(row.organization_id) !== String(organizationId)) {
    return { started: false, reason: 'wrong_org' };
  }
  if (row.source !== 'vexa') return { started: false, reason: 'not_a_meeting' };
  if (!['pending', 'processing'].includes(row.status)) {
    return { started: false, reason: `status=${row.status}` };
  }
  if (!row.in_meeting_overlay_enabled) {
    return { started: false, reason: 'overlay_disabled' };
  }
  if (!row.translation_config?.enabled) {
    return { started: false, reason: 'translation_disabled' };
  }
  if (!forceRestart && row.overlay_started_at) {
    return { started: false, reason: 'already_started' };
  }

  // Need a share-token so the bot has a public URL to render.
  let token = row.public_share_token;
  let expiresAt = row.public_share_expires_at;
  if (
    !token
    || !expiresAt
    || new Date(expiresAt).getTime() <= Date.now()
  ) {
    try {
      const minted = await ensureShareTokenForRow({
        transcriptionId,
        organizationId: row.organization_id,
        ttlHours: 24,
      });
      if (!minted) return { started: false, reason: 'share_token_unavailable' };
      token = minted.token;
      expiresAt = minted.expiresAt;
    } catch (error) {
      logError('overlay.share_token_mint_failed', error, { transcriptionId });
      return { started: false, reason: 'share_token_mint_failed' };
    }
  }

  // Resolve Vexa config + the bot owner's user-token.
  let baseUrl;
  let apiKey;
  try {
    const integration = await resolveVexaConfig(row.organization_id);
    if (!integration.enabled || !integration.config?.baseUrl) {
      return { started: false, reason: 'integration_disabled' };
    }
    baseUrl = integration.config.baseUrl;

    const tokenRow = await query(
      `SELECT api_key_encrypted FROM vexa_user_tokens
        WHERE user_id = $1 AND organization_id = $2`,
      [row.user_id, row.organization_id],
    );
    if (!tokenRow.rows.length) return { started: false, reason: 'no_user_token' };
    apiKey = decryptSecret(tokenRow.rows[0].api_key_encrypted, {
      field: SECRET_CONTEXTS.vexaUserToken,
      bindingId: row.organization_id,
    });
    if (!apiKey) return { started: false, reason: 'token_decrypt_failed' };
  } catch (error) {
    logError('overlay.config_lookup_failed', error, { transcriptionId });
    return { started: false, reason: 'config_lookup_failed' };
  }

  // The overlay path is a sub-URL of the share root: `/share/[token]/overlay`.
  const overlayUrl = `${buildShareUrl(token)}/overlay`;

  try {
    await setBotScreenContent(
      { baseUrl, apiKey },
      {
        platform: row.meeting_platform,
        nativeMeetingId: row.native_meeting_id,
        type: 'url',
        url: overlayUrl,
        startShare: true,
      },
    );
  } catch (error) {
    logError('overlay.set_screen_failed', error, {
      transcriptionId,
      platform: row.meeting_platform,
    });
    return { started: false, reason: 'send_failed', error: error.message };
  }

  await query(
    `UPDATE transcriptions
        SET overlay_started_at = NOW(),
            updated_at = NOW()
      WHERE id = $1`,
    [transcriptionId],
  );

  await addTranscriptionEvent({
    transcriptionId,
    userId: row.user_id,
    organizationId: row.organization_id,
    stage: 'overlay_started',
    message: 'Untertitel-Kachel im Meeting aktiviert (Bot-Kamera).',
  });
  logInfo('overlay.started', { transcriptionId });
  return { started: true, overlayUrl };
}

/**
 * Best-effort cleanup. Called from the `meeting.completed` /
 * `meeting.failed` webhook so the bot's camera reverts to the default
 * Vexa avatar before it leaves the meeting. Also resets the idempotency
 * stamp so a fresh meeting on the same row would re-trigger cleanly
 * (defensive — meetings normally have unique transcriptionIds anyway).
 */
export async function clearOverlay({ transcriptionId, organizationId }) {
  let row;
  try {
    const result = await query(
      `SELECT id, user_id, organization_id, source,
              meeting_platform, native_meeting_id,
              overlay_started_at
         FROM transcriptions
        WHERE id = $1`,
      [transcriptionId],
    );
    row = result.rows[0];
  } catch (error) {
    logError('overlay.clear_lookup_failed', error, { transcriptionId });
    return { cleared: false, reason: 'row_lookup_failed' };
  }
  if (!row) return { cleared: false, reason: 'row_not_found' };
  if (organizationId && String(row.organization_id) !== String(organizationId)) {
    return { cleared: false, reason: 'wrong_org' };
  }
  if (row.source !== 'vexa') return { cleared: false, reason: 'not_a_meeting' };
  if (!row.overlay_started_at) return { cleared: false, reason: 'never_started' };

  let baseUrl;
  let apiKey;
  try {
    const integration = await resolveVexaConfig(row.organization_id);
    if (!integration.enabled || !integration.config?.baseUrl) {
      return { cleared: false, reason: 'integration_disabled' };
    }
    baseUrl = integration.config.baseUrl;
    const tokenRow = await query(
      `SELECT api_key_encrypted FROM vexa_user_tokens
        WHERE user_id = $1 AND organization_id = $2`,
      [row.user_id, row.organization_id],
    );
    if (!tokenRow.rows.length) return { cleared: false, reason: 'no_user_token' };
    apiKey = decryptSecret(tokenRow.rows[0].api_key_encrypted, {
      field: SECRET_CONTEXTS.vexaUserToken,
      bindingId: row.organization_id,
    });
    if (!apiKey) return { cleared: false, reason: 'token_decrypt_failed' };
  } catch (error) {
    logError('overlay.clear_config_failed', error, { transcriptionId });
    return { cleared: false, reason: 'config_lookup_failed' };
  }

  try {
    await clearBotScreenContent(
      { baseUrl, apiKey },
      { platform: row.meeting_platform, nativeMeetingId: row.native_meeting_id },
    );
  } catch (error) {
    // Common case: bot is already gone (Vexa returned 404). Not fatal.
    logError('overlay.clear_send_failed', error, { transcriptionId });
    return { cleared: false, reason: 'send_failed' };
  }

  await query(
    `UPDATE transcriptions SET overlay_started_at = NULL WHERE id = $1`,
    [transcriptionId],
  );
  logInfo('overlay.cleared', { transcriptionId });
  return { cleared: true };
}
