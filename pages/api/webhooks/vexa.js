import { query } from '../../../lib/db';
import { verifyVexaSignature } from '../../../lib/vexa-webhook-signature';
import { logApiError, serverError } from '../../../lib/api-utils';
import { logAuditEvent } from '../../../lib/audit-log';
import { addTranscriptionEvent } from '../../../lib/transcription-events';
import { resolveVexaConfig } from '../../../lib/integrations';
import { decryptSecret } from '../../../lib/secrets';
import { getTranscript, mapVexaTranscriptToGhostTyper } from '../../../lib/api/vexa';
import { runManualAnalysisJob } from '../../../lib/manual-analysis';
import { startBridgeForTranscription, stopBridgeForTranscription } from '../../../lib/vexa-bridge';
import { logUsage } from '../../../lib/usage';

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

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
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
  return decryptSecret(result.rows[0].api_key_encrypted);
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
}

async function handleCompleted(transcription, payload, vexaConfig) {
  stopBridgeForTranscription(transcription.id, 'meeting.completed');
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

  // Whisper cost: input_tokens column doubles as audio-seconds (see usage.js
  // MODEL_PRICING comment). Per-user/org attribution flows through usage_log.
  const seconds = totalAudioSeconds(mapped.segments);
  if (seconds > 0) {
    await logUsage(
      transcription.user_id,
      'whisper-v3',
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

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    logApiError('Webhook body read failed', error);
    return serverError(res, 'Body konnte nicht gelesen werden.');
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ code: 'INVALID_JSON' });
  }

  const meeting = pickMeetingFields(payload);
  const transcription = await loadTranscriptionByMeeting(meeting);
  if (!transcription) {
    return res.status(202).json({ code: 'IGNORED', message: 'No matching meeting.' });
  }

  const integration = await resolveVexaConfig(transcription.organization_id);
  if (!integration.enabled) {
    return res.status(202).json({ code: 'IGNORED', message: 'Integration disabled for org.' });
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
    return res.status(401).json({ code: 'INVALID_SIGNATURE' });
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
