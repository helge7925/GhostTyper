import { query } from './db';
import { resolveVexaConfig } from './integrations';
import { decryptSecret } from './secrets';
import { sendBotChatMessage } from './api/vexa';
import { addTranscriptionEvent } from './transcription-events';
import { logError, logInfo } from './observability';

const DEFAULT_NOTICE_DE = 'Hinweis: Dieses Meeting wird zu Protokollzwecken automatisch transkribiert. Wenn Sie nicht einverstanden sind, melden Sie sich bitte jetzt.';

/**
 * Idempotent helper: post a GDPR notice into the meeting chat once
 * the bot has joined. Triggered from the `meeting.started` webhook
 * (lib/webhooks/vexa.js) parallel to the share-link auto-post.
 *
 * Idempotency via `gdpr_notice_posted_at` mirrors the share-link
 * pattern — webhook retries don't double-post.
 *
 * Failures are swallowed: if the chat-send fails (bot not yet ready,
 * platform without chat surface, Talk-fork without sendNextcloudTalkChat
 * implemented), the meeting still proceeds. The host already saw the
 * dialog-level consent acknowledgement at meeting start.
 */
export async function ensureGdprNoticePostedToChat({ transcriptionId, organizationId } = {}) {
  let row;
  try {
    const result = await query(
      `SELECT id, user_id, organization_id, source, status,
              meeting_platform, native_meeting_id,
              gdpr_notice_enabled, gdpr_notice_posted_at
         FROM transcriptions
        WHERE id = $1`,
      [transcriptionId],
    );
    row = result.rows[0];
  } catch (error) {
    logError('gdpr_chat_poster.row_lookup_failed', error, { transcriptionId });
    return { posted: false, reason: 'row_lookup_failed' };
  }
  if (!row) return { posted: false, reason: 'row_not_found' };
  if (organizationId && String(row.organization_id) !== String(organizationId)) {
    return { posted: false, reason: 'wrong_org' };
  }
  if (row.source !== 'vexa') return { posted: false, reason: 'not_a_meeting' };
  if (!row.gdpr_notice_enabled) return { posted: false, reason: 'disabled' };
  if (row.gdpr_notice_posted_at) return { posted: false, reason: 'already_posted' };
  if (!['pending', 'processing'].includes(row.status)) {
    return { posted: false, reason: `status=${row.status}` };
  }

  let baseUrl;
  let apiKey;
  let vexaCfg;
  try {
    const integration = await resolveVexaConfig(row.organization_id);
    if (!integration.enabled || !integration.config?.baseUrl) {
      return { posted: false, reason: 'integration_disabled' };
    }
    baseUrl = integration.config.baseUrl;
    vexaCfg = integration.config;

    const tokenRow = await query(
      `SELECT api_key_encrypted FROM vexa_user_tokens
        WHERE user_id = $1 AND organization_id = $2`,
      [row.user_id, row.organization_id],
    );
    if (!tokenRow.rows.length) return { posted: false, reason: 'no_user_token' };
    apiKey = decryptSecret(tokenRow.rows[0].api_key_encrypted);
    if (!apiKey) return { posted: false, reason: 'token_decrypt_failed' };
  } catch (error) {
    logError('gdpr_chat_poster.config_lookup_failed', error, { transcriptionId });
    return { posted: false, reason: 'config_lookup_failed' };
  }

  const noticeText = (vexaCfg.gdprChatNoticeText && vexaCfg.gdprChatNoticeText.trim())
    || DEFAULT_NOTICE_DE;

  try {
    await sendBotChatMessage(
      { baseUrl, apiKey },
      {
        platform: row.meeting_platform,
        nativeMeetingId: row.native_meeting_id,
        text: noticeText,
      },
    );
  } catch (error) {
    logError('gdpr_chat_poster.send_failed', error, {
      transcriptionId,
      platform: row.meeting_platform,
    });
    // Surface the failure in the meeting timeline so the host knows the
    // notice did NOT reach the chat (e.g. a platform whose bot has no
    // chat-send handler yet, like the current Nextcloud-Talk image).
    await addTranscriptionEvent({
      transcriptionId,
      userId: row.user_id,
      organizationId: row.organization_id,
      stage: 'gdpr_notice_failed',
      message: `DSGVO-Hinweis konnte nicht in den Meeting-Chat gepostet werden (${row.meeting_platform}). Bitte mündlich ankündigen.`,
      meta: { error: error.message, platform: row.meeting_platform },
    }).catch(() => { /* event logging is best-effort */ });
    return { posted: false, reason: 'send_failed', error: error.message };
  }

  await query(
    `UPDATE transcriptions SET gdpr_notice_posted_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [transcriptionId],
  );

  await addTranscriptionEvent({
    transcriptionId,
    userId: row.user_id,
    organizationId: row.organization_id,
    stage: 'gdpr_notice_posted',
    message: 'DSGVO-Hinweis automatisch im Meeting-Chat gepostet.',
  });
  logInfo('gdpr_chat_poster.posted', { transcriptionId });
  return { posted: true };
}
