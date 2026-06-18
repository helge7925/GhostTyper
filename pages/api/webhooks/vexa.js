import { query } from '../../../lib/db';
import { verifyVexaSignature } from '../../../lib/vexa-webhook-signature';
import { logApiError, serverError } from '../../../lib/api-utils';
import { logAuditEvent } from '../../../lib/audit-log';
import { addTranscriptionEvent } from '../../../lib/transcription-events';
import { resolveVexaConfig } from '../../../lib/integrations';
import { decryptSecret, SECRET_CONTEXTS } from '../../../lib/secrets';
import { getTranscript, mapVexaTranscriptToGhostTyper } from '../../../lib/api/vexa';
import { runManualAnalysisJob } from '../../../lib/manual-analysis';
import { startBridgeForTranscription, stopBridgeForTranscription } from '../../../lib/vexa-bridge';
import { ensureShareLinkPostedToChat } from '../../../lib/share-chat-poster';
import { ensureGdprNoticePostedToChat } from '../../../lib/gdpr-chat-poster';
import { ensureOverlayStarted, clearOverlay } from '../../../lib/in-meeting-overlay';
import { stopInMeetingAudio } from '../../../lib/in-meeting-audio';
import { logUsage } from '../../../lib/usage';
import { autoIndexDocument } from '../../../lib/document-index';

function totalAudioSeconds(segments) {
  if (!Array.isArray(segments) || !segments.length) return 0;
  // Use the last segment's end as the total duration of transcribed audio.
  const last = segments[segments.length - 1];
  const ended = typeof last.end === 'number' ? last.end : 0;
  return Math.max(0, Math.ceil(ended));
}

export const config = {
  api: { bodyParser: false },
};

// Hard cap on the webhook body. Vexa events are tiny status payloads (well
// under 8 KB in practice); 256 KB leaves room for future fields without
// allowing an unauthenticated POST to exhaust the heap before HMAC is
// even checked. Hit-the-cap → 413, no buffering of the rest.
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

async function readRawBody(req, maxBytes = MAX_WEBHOOK_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      fn(value);
    };
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        const err = new Error('WEBHOOK_BODY_TOO_LARGE');
        err.code = 'WEBHOOK_BODY_TOO_LARGE';
        try { req.destroy(err); } catch { /* noop */ }
        finish(reject, err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish(resolve, Buffer.concat(chunks)));
    req.on('error', (err) => finish(reject, err));
  });
}

async function recordEventOnce(eventId) {
  if (!eventId) return true;
  const result = await query(
    `INSERT INTO vexa_webhook_events (event_id) VALUES ($1) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
    [eventId],
  );
  return result.rowCount > 0;
}

async function loadTranscriptionByMeeting({ platform, nativeMeetingId, externalMeetingId }) {
  if (externalMeetingId) {
    const result = await query(
      `SELECT id, user_id, organization_id, source, status, auto_analyze, custom_prompt
         FROM transcriptions
        WHERE external_meeting_id = $1
        ORDER BY id DESC
        LIMIT 1`,
      [String(externalMeetingId)],
    );
    if (result.rows.length) return result.rows[0];
  }
  if (platform && nativeMeetingId) {
    const result = await query(
      `SELECT id, user_id, organization_id, source, status, auto_analyze, custom_prompt
         FROM transcriptions
        WHERE source = 'vexa'
          AND meeting_platform = $1
          AND native_meeting_id = $2
        ORDER BY id DESC
        LIMIT 1`,
      [platform, nativeMeetingId],
    );
    if (result.rows.length) return result.rows[0];
  }
  return null;
}

function pickMeetingFields(payload) {
  const meeting = payload?.data?.meeting || {};
  return {
    platform: meeting.platform || null,
    nativeMeetingId: meeting.native_meeting_id || null,
    externalMeetingId: meeting.id != null ? String(meeting.id) : null,
    status: meeting.status || null,
  };
}

async function loadUserToken(userId, orgId) {
  const result = await query(
    `SELECT api_key_encrypted FROM vexa_user_tokens WHERE user_id = $1 AND organization_id = $2`,
    [userId, orgId],
  );
  if (!result.rows.length) return null;
  return decryptSecret(result.rows[0].api_key_encrypted, {
    field: SECRET_CONTEXTS.vexaUserToken,
    bindingId: orgId,
  });
}

async function handleStarted(transcription, payload) {
  await query(
    `UPDATE transcriptions
        SET status = 'processing', bot_status = 'active', meeting_started_at = COALESCE(meeting_started_at, NOW()), updated_at = NOW()
      WHERE id = $1`,
    [transcription.id],
  );
  await addTranscriptionEvent({
    transcriptionId: transcription.id,
    userId: transcription.user_id,
    organizationId: transcription.organization_id,
    stage: 'processing',
    message: 'Bot ist im Meeting aktiv.',
    meta: { event: payload.event_type },
  });
  startBridgeForTranscription(transcription.id);

  // If translation+share were enabled at meeting start, the bot is now
  // in the room and can post the share-link into the meeting chat so
  // every participant can open the companion view in their own
  // browser. Idempotent — skipped if no share-token exists or the
  // post already happened (manual toggle, retried webhook, etc.).
  try {
    await ensureShareLinkPostedToChat({
      transcriptionId: transcription.id,
      organizationId: transcription.organization_id,
    });
  } catch (error) {
    logApiError('vexa webhook share-link auto-post failed', error, {
      transcriptionId: transcription.id,
    });
  }

  // If the host opted into the in-meeting subtitle overlay, switch the
  // bot's webcam canvas to the public `/share/[token]/overlay` page so
  // participants see the live translation on the bot's gallery tile —
  // even without opening the companion-tab themselves.
  try {
    await ensureOverlayStarted({
      transcriptionId: transcription.id,
      organizationId: transcription.organization_id,
    });
  } catch (error) {
    logApiError('vexa webhook overlay start failed', error, {
      transcriptionId: transcription.id,
    });
  }

  // GDPR chat notice: if the host (or workspace default) asked for it,
  // post the announcement into the meeting chat now that the bot is
  // actually in the room. Idempotent via gdpr_notice_posted_at.
  try {
    await ensureGdprNoticePostedToChat({
      transcriptionId: transcription.id,
      organizationId: transcription.organization_id,
    });
  } catch (error) {
    logApiError('vexa webhook GDPR notice post failed', error, {
      transcriptionId: transcription.id,
    });
  }
}

async function handleStatusChange(transcription, payload) {
  const meeting = pickMeetingFields(payload);
  await query(
    `UPDATE transcriptions SET bot_status = COALESCE($1, bot_status), updated_at = NOW() WHERE id = $2`,
    [meeting.status, transcription.id],
  );
  await addTranscriptionEvent({
    transcriptionId: transcription.id,
    userId: transcription.user_id,
    organizationId: transcription.organization_id,
    stage: 'vexa_status',
    message: `Bot-Status: ${meeting.status || 'unbekannt'}.`,
    meta: { event: payload.event_type, status: meeting.status },
  });
}

async function handleFailed(transcription, payload) {
  stopBridgeForTranscription(transcription.id, 'bot.failed');
  const reason = payload?.data?.status_change?.reason || 'Bot-Beitritt fehlgeschlagen.';
  await query(
    `UPDATE transcriptions SET status = 'error', bot_status = 'failed', error = $1, updated_at = NOW() WHERE id = $2`,
    [String(reason).slice(0, 500), transcription.id],
  );
  await addTranscriptionEvent({
    transcriptionId: transcription.id,
    userId: transcription.user_id,
    organizationId: transcription.organization_id,
    stage: 'error',
    message: `Bot fehlgeschlagen: ${reason}`,
    meta: { event: payload.event_type },
  });
  // Best-effort overlay cleanup. If the bot got far enough to have an
  // overlay running, revert its camera so it doesn't keep showing
  // stale subtitles while it leaves.
  await clearOverlay({
    transcriptionId: transcription.id,
    organizationId: transcription.organization_id,
  }).catch(() => { /* best-effort */ });
  await stopInMeetingAudio({
    transcriptionId: transcription.id,
    organizationId: transcription.organization_id,
  }).catch(() => { /* best-effort */ });
}

async function handleCompleted(transcription, payload, vexaConfig) {
  stopBridgeForTranscription(transcription.id, 'meeting.completed');
  // Clear the bot-camera overlay before the bot leaves (best-effort).
  // Doing this early — before the long getTranscript path — so the
  // bot's tile reverts as fast as possible if it's still in the room.
  await clearOverlay({
    transcriptionId: transcription.id,
    organizationId: transcription.organization_id,
  }).catch(() => { /* best-effort */ });
  await stopInMeetingAudio({
    transcriptionId: transcription.id,
    organizationId: transcription.organization_id,
  }).catch(() => { /* best-effort */ });
  const meeting = pickMeetingFields(payload);
  const apiKey = await loadUserToken(transcription.user_id, transcription.organization_id);
  if (!apiKey) {
    throw new Error(`No Vexa user token for user=${transcription.user_id} org=${transcription.organization_id}`);
  }

  const transcript = await getTranscript(
    { baseUrl: vexaConfig.baseUrl, apiKey },
    { platform: meeting.platform, nativeMeetingId: meeting.nativeMeetingId },
  );
  const mapped = mapVexaTranscriptToGhostTyper(transcript);

  await query(
    `UPDATE transcriptions
        SET status = 'transcribed',
            bot_status = 'completed',
            text = $1,
            segments = $2::jsonb,
            speakers = $3::jsonb,
            meeting_ended_at = COALESCE(meeting_ended_at, NOW()),
            updated_at = NOW()
      WHERE id = $4`,
    [mapped.text, JSON.stringify(mapped.segments), JSON.stringify(mapped.speakers), transcription.id],
  );

  await addTranscriptionEvent({
    transcriptionId: transcription.id,
    userId: transcription.user_id,
    organizationId: transcription.organization_id,
    stage: 'completed',
    message: 'Meeting beendet, Transkript gespeichert.',
    meta: { segments: mapped.segments.length, speakers: mapped.speakers.length },
  });

  // Index the final meeting transcript (text + segments). A later auto-analysis
  // only adds the analysis field, which isn't part of the index, so indexing here
  // already captures the indexable content.
  void autoIndexDocument({
    transcriptionId: transcription.id,
    organizationId: transcription.organization_id,
    userId: transcription.user_id,
  });

  // STT cost: input_tokens column doubles as audio-seconds (see usage.js
  // MODEL_PRICING comment). Per-user/org attribution flows through usage_log.
  const seconds = totalAudioSeconds(mapped.segments);
  if (seconds > 0) {
    await logUsage(
      transcription.user_id,
      'whisper-large-v3',
      'meeting_transcription',
      { input_tokens: seconds, output_tokens: 0 },
      transcription.organization_id,
    );
  }

  if (transcription.auto_analyze) {
    const lock = await query(
      `UPDATE transcriptions SET status = 'analyzing', updated_at = NOW()
        WHERE id = $1 AND status = 'transcribed' RETURNING id`,
      [transcription.id],
    );
    if (lock.rowCount > 0) {
      await addTranscriptionEvent({
        transcriptionId: transcription.id,
        userId: transcription.user_id,
        organizationId: transcription.organization_id,
        stage: 'analyzing',
        message: 'Auto-Analyse nach Meeting-Ende gestartet.',
      });
      queueMicrotask(() => {
        runManualAnalysisJob({
          transcriptionId: transcription.id,
          userId: transcription.user_id,
          organizationId: transcription.organization_id,
        }).catch((error) => {
          logApiError(`Vexa auto-analysis ${transcription.id} failed`, error);
        });
      });
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }

  // We respond with the same uninformative 202 for *every* pre-auth or
  // pre-match rejection so an unauthenticated attacker can't enumerate
  // existing meetings, active orgs, or signature validity by diffing
  // status codes. All real failure paths still produce a (warn-level)
  // audit event for operators.
  const ACK = () => res.status(202).json({ ok: true });

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    if (error?.code === 'WEBHOOK_BODY_TOO_LARGE') {
      // Body exceeded our hard cap before HMAC could even be evaluated —
      // surface 413 because there is no security-sensitive distinction:
      // the request never reached the HMAC step.
      return res.status(413).json({ code: 'BODY_TOO_LARGE' });
    }
    logApiError('Webhook body read failed', error);
    return ACK();
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return ACK();
  }

  const meeting = pickMeetingFields(payload);
  const transcription = await loadTranscriptionByMeeting(meeting);
  if (!transcription) {
    return ACK();
  }

  const integration = await resolveVexaConfig(transcription.organization_id);
  if (!integration.enabled) {
    return ACK();
  }
  const vexaConfig = integration.config;
  const secret = vexaConfig.webhookSecret;

  if (!verifyVexaSignature({
    rawBody,
    secret,
    signatureHeader: req.headers['x-webhook-signature'],
    timestampHeader: req.headers['x-webhook-timestamp'],
  })) {
    await logAuditEvent({
      userId: null,
      organizationId: transcription.organization_id,
      action: 'meeting.webhook.rejected',
      targetType: 'transcription',
      targetId: String(transcription.id),
      severity: 'warn',
      metadata: { eventType: payload.event_type, reason: 'bad_signature' },
    });
    // Constant-shape ACK: same as "ignored / not found" so attackers can't
    // distinguish "wrong signature for known meeting" from "unknown meeting".
    return ACK();
  }

  const fresh = await recordEventOnce(payload.event_id);
  if (!fresh) {
    return res.status(200).json({ ok: true, deduplicated: true });
  }

  try {
    switch (payload.event_type) {
      case 'meeting.started':
        await handleStarted(transcription, payload);
        break;
      case 'meeting.status_change':
        await handleStatusChange(transcription, payload);
        break;
      case 'bot.failed':
        await handleFailed(transcription, payload);
        break;
      case 'meeting.completed':
        await handleCompleted(transcription, payload, vexaConfig);
        break;
      default:
        await addTranscriptionEvent({
          transcriptionId: transcription.id,
          userId: transcription.user_id,
          organizationId: transcription.organization_id,
          stage: 'vexa_event',
          message: `Unbehandeltes Vexa-Event: ${payload.event_type}`,
          meta: { eventType: payload.event_type },
        });
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    logApiError(`Vexa webhook ${payload.event_type} failed`, error, {
      transcriptionId: transcription.id,
    });
    await logAuditEvent({
      userId: null,
      organizationId: transcription.organization_id,
      action: 'meeting.webhook.failed',
      targetType: 'transcription',
      targetId: String(transcription.id),
      severity: 'warn',
      metadata: { eventType: payload.event_type, error: error.message },
    });
    return res.status(500).json({ code: 'WEBHOOK_FAILED', message: error.message });
  }
}
