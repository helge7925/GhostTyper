import crypto from 'crypto';
import { query } from '../../../../lib/db';
import { logApiError } from '../../../../lib/api-utils';
import { addTranscriptionEvent } from '../../../../lib/transcription-events';
import { logAuditEvent } from '../../../../lib/audit-log';
import { resolveVexaConfig } from '../../../../lib/integrations';
import { decryptSecret, SECRET_CONTEXTS } from '../../../../lib/secrets';
import { getTranscript, mapVexaTranscriptToGhostTyper } from '../../../../lib/api/vexa';
import { runManualAnalysisJob } from '../../../../lib/manual-analysis';
import {
  checkpointVexaMeetingSpend,
  isVexaBudgetSafetyError,
  startBridgeForTranscription,
  stopBridgeForTranscription,
  isBridgeActive,
} from '../../../../lib/vexa-bridge';
import { decideJoinTimeout, vexaReportsActive } from '../../../../lib/vexa-bridge-utils';

// Bridge keeps `updated_at` fresh while polling Vexa every 2 s, so a
// row only goes stale once the in-process bridge stops (Vexa says
// completed/failed, container restart, etc.). 1 minute is fast enough
// to feel real-time and avoids racing with the bridge.
const STALE_MINUTES = 1;
const HARD_TIMEOUT_HOURS = 6;
const PER_RUN_LIMIT = 25;
// Join window: a bot still stuck in an early lifecycle state this long
// after the row was created, with no segments and no "active" signal from
// Vexa, is treated as never-admitted (→ rejected). Env-tunable.
const JOIN_TIMEOUT_MS = Number(process.env.VEXA_JOIN_TIMEOUT_MS) || 120_000;

function checkSecret(req) {
  const expected = process.env.RECONCILE_API_SECRET;
  if (!expected) return false;
  const provided = req.headers['x-reconcile-secret'] || '';
  if (typeof provided !== 'string' || provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function loadOpenMeetings() {
  const result = await query(
    `SELECT id, user_id, organization_id, status, bot_status, auto_analyze,
             meeting_platform, native_meeting_id, external_meeting_id,
             updated_at, created_at, meeting_started_at,
            CASE WHEN jsonb_typeof(segments) = 'array'
                 THEN jsonb_array_length(segments) ELSE 0 END AS segment_count
       FROM transcriptions
      WHERE source = 'vexa'
         AND status IN ('pending', 'processing')
         AND budget_stop_state = 'none'
        AND updated_at < NOW() - ($1 || ' minutes')::interval
      ORDER BY updated_at ASC
      LIMIT $2`,
    [String(STALE_MINUTES), PER_RUN_LIMIT],
  );
  return result.rows;
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

// Never-admitted bot: the join window elapsed with no segments and no
// "active" signal. Flip the row to a clear rejected error state, drop the
// live bridge, and leave a transcription event that points at tab-audio
// capture as the fallback. Guarded on status so we never clobber a row a
// concurrent webhook/finalize already moved on.
async function rejectNeverAdmitted(row) {
  const errorMessage = 'Der Bot wurde nicht ins Meeting eingelassen — keine Freigabe, kein Ton nach '
    + `${Math.round(JOIN_TIMEOUT_MS / 1000)} s. Prüfe die Lobby-/Freigabe-Einstellungen des Meetings `
    + 'oder nutze stattdessen die Tab-/System-Audio-Aufnahme.';
  const locked = await query(
    `UPDATE transcriptions SET status = 'error', bot_status = 'rejected',
                               error = $1, updated_at = NOW()
      WHERE id = $2 AND status IN ('pending','processing') AND budget_stop_state = 'none'
      RETURNING id`,
    [errorMessage.slice(0, 500), row.id],
  );
  if (locked.rowCount === 0) return { id: row.id, action: 'race_lost' };
  await addTranscriptionEvent({
    transcriptionId: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    stage: 'error',
    message: 'Bot nicht ins Meeting eingelassen. Tipp: Tab-/System-Audio-Aufnahme als Alternative nutzen.',
    meta: { reason: 'join_timeout', botStatus: row.bot_status },
  });
  stopBridgeForTranscription(row.id, 'rejected');
  return { id: row.id, action: 'rejected_join_timeout' };
}

// Shared join-timeout gate — pure decision fed by the row + optional Vexa
// meeting status. `vexaActive` defaults false (e.g. Vexa 404 / unreachable).
function shouldRejectForJoinTimeout(row, { meetingStatus = null, extraSegments = 0 } = {}) {
  return decideJoinTimeout({
    botStatus: row.bot_status,
    createdAtMs: new Date(row.created_at).getTime(),
    nowMs: Date.now(),
    hasSegments: Number(row.segment_count) > 0 || extraSegments > 0,
    vexaActive: vexaReportsActive(meetingStatus),
    joinTimeoutMs: JOIN_TIMEOUT_MS,
  });
}

async function reconcileOne(row) {
  const ageHours = (Date.now() - new Date(row.created_at).getTime()) / 3_600_000;
  if (ageHours > HARD_TIMEOUT_HOURS) {
    await query(
      `UPDATE transcriptions SET status = 'error', bot_status = 'failed',
                                 error = 'Reconcile-Timeout (kein Webhook eingegangen)',
                                 updated_at = NOW()
        WHERE id = $1 AND status IN ('pending','processing') AND budget_stop_state = 'none'`,
      [row.id],
    );
    await addTranscriptionEvent({
      transcriptionId: row.id,
      userId: row.user_id,
      organizationId: row.organization_id,
      stage: 'error',
      message: 'Reconcile: Hard-Timeout erreicht.',
    });
    return { id: row.id, action: 'timeout' };
  }

  const integration = await resolveVexaConfig(row.organization_id);
  if (!integration.enabled || !integration.config?.baseUrl) {
    return { id: row.id, action: 'skipped_no_integration' };
  }
  const apiKey = await loadUserToken(row.user_id, row.organization_id);
  if (!apiKey) return { id: row.id, action: 'skipped_no_token' };

  let transcript;
  try {
    transcript = await getTranscript(
      { baseUrl: integration.config.baseUrl, apiKey },
      { platform: row.meeting_platform, nativeMeetingId: row.native_meeting_id },
    );
  } catch (error) {
    if (error.response?.status === 404) {
      // Bot not in Vexa at all. If it never got past an early state within
      // the join window and produced nothing, it was never admitted.
      if (shouldRejectForJoinTimeout(row)) {
        return rejectNeverAdmitted(row);
      }
      return { id: row.id, action: 'skipped_not_in_vexa' };
    }
    logApiError(`Reconcile getTranscript failed for ${row.id}`, error);
    return { id: row.id, action: 'error', message: error.message };
  }

  const meetingStatus = transcript?.meeting?.status || transcript?.status;
  const segments = Array.isArray(transcript?.segments) ? transcript.segments : [];

  // While the meeting is still active in Vexa, sync segments so the
  // editor sees them (catches up if the in-process bridge died), but
  // do NOT finalize. Finalization is only legitimate when Vexa itself
  // says the meeting is over.
  if (meetingStatus !== 'completed' && meetingStatus !== 'failed') {
    // Join-timeout: bot still in an early state past the window, nothing
    // produced anywhere, and Vexa doesn't report it active → never admitted.
    if (shouldRejectForJoinTimeout(row, { meetingStatus, extraSegments: segments.length })) {
      return rejectNeverAdmitted(row);
    }
    if (segments.length > 0) {
      const mappedLive = mapVexaTranscriptToGhostTyper(transcript);
      const synced = await query(
        `UPDATE transcriptions
            SET segments = $1::jsonb,
                speakers = $2::jsonb,
                text = $3,
                updated_at = NOW()
          WHERE id = $4 AND status IN ('pending','processing') AND budget_stop_state = 'none'
          RETURNING id`,
        [JSON.stringify(mappedLive.segments), JSON.stringify(mappedLive.speakers), mappedLive.text, row.id],
      );
      if (synced.rowCount === 0) return { id: row.id, action: 'budget_stopped' };
    }
    try {
      await checkpointVexaMeetingSpend({
        transcript,
        transcriptionId: row.id,
        organizationId: row.organization_id,
        userId: row.user_id,
        meetingStartedAt: row.meeting_started_at,
        ongoing: true,
        baseUrl: integration.config.baseUrl,
        apiKey,
        platform: row.meeting_platform,
        nativeMeetingId: row.native_meeting_id,
      });
    } catch (error) {
      if (isVexaBudgetSafetyError(error)) {
        return { id: row.id, action: 'budget_stop_requested' };
      }
      throw error;
    }
    // Bridge recovery: this row is genuinely still running, so if the
    // in-process bridge died (deploy/restart mid-meeting) re-attach it.
    // Idempotent — isBridgeActive guards a live bridge on the same instance.
    if (!isBridgeActive(row.id)) {
      const runnable = await query(
        `SELECT 1 FROM transcriptions
          WHERE id = $1 AND status IN ('pending','processing') AND budget_stop_state = 'none'`,
        [row.id],
      );
      if (!runnable.rowCount) return { id: row.id, action: 'budget_stopped' };
      startBridgeForTranscription(row.id, {
        source: 'vexa',
        userId: row.user_id,
        organizationId: row.organization_id,
        baseUrl: integration.config.baseUrl,
        apiKey,
        platform: row.meeting_platform,
        nativeMeetingId: row.native_meeting_id,
      });
    }
    return { id: row.id, action: 'still_running' };
  }

  if (meetingStatus === 'failed') {
    await query(
      `UPDATE transcriptions SET status = 'error', bot_status = 'failed',
                                 error = 'Vexa meldet failed (Reconcile)',
                                 updated_at = NOW()
        WHERE id = $1 AND status IN ('pending','processing') AND budget_stop_state = 'none'`,
      [row.id],
    );
    await addTranscriptionEvent({
      transcriptionId: row.id,
      userId: row.user_id,
      organizationId: row.organization_id,
      stage: 'error',
      message: 'Reconcile: Vexa meldet failed.',
    });
    return { id: row.id, action: 'failed_via_reconcile' };
  }

  const mapped = mapVexaTranscriptToGhostTyper(transcript);
  try {
    await checkpointVexaMeetingSpend({
      transcript,
      transcriptionId: row.id,
      organizationId: row.organization_id,
      userId: row.user_id,
      meetingStartedAt: row.meeting_started_at,
      ongoing: false,
      final: true,
      baseUrl: integration.config.baseUrl,
      apiKey,
      platform: row.meeting_platform,
      nativeMeetingId: row.native_meeting_id,
    });
  } catch (error) {
    if (isVexaBudgetSafetyError(error)) {
      return { id: row.id, action: 'budget_stop_requested' };
    }
    throw error;
  }
  const lock = await query(
    `UPDATE transcriptions
        SET status = 'transcribed',
            bot_status = 'completed',
            text = $1,
            segments = $2::jsonb,
            speakers = $3::jsonb,
            meeting_ended_at = COALESCE(meeting_ended_at, NOW()),
            updated_at = NOW()
      WHERE id = $4 AND status IN ('pending','processing') AND budget_stop_state = 'none'
      RETURNING id`,
    [mapped.text, JSON.stringify(mapped.segments), JSON.stringify(mapped.speakers), row.id],
  );
  if (lock.rowCount === 0) {
    return { id: row.id, action: 'race_lost' };
  }
  await addTranscriptionEvent({
    transcriptionId: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    stage: 'completed',
    message: 'Reconcile: Transkript nachträglich gespeichert.',
    meta: { segments: mapped.segments.length, speakers: mapped.speakers.length },
  });

  if (row.auto_analyze) {
    const analyzeLock = await query(
      `UPDATE transcriptions SET status = 'analyzing', updated_at = NOW()
        WHERE id = $1 AND status = 'transcribed' AND budget_stop_state = 'none' RETURNING id`,
      [row.id],
    );
    if (analyzeLock.rowCount > 0) {
      queueMicrotask(() => {
        runManualAnalysisJob({
          transcriptionId: row.id,
          userId: row.user_id,
          organizationId: row.organization_id,
        }).catch((error) => {
          logApiError(`Reconcile auto-analysis ${row.id} failed`, error);
        });
      });
    }
  }
  return { id: row.id, action: 'completed_via_reconcile' };
}

/**
 * Internal entry point shared between the HTTP endpoint and the
 * in-process reconcile worker. No auth check; only call from trusted
 * server-side code.
 */
export async function runReconcileScan() {
  const meetings = await loadOpenMeetings();
  const results = [];
  for (const row of meetings) {
    try {
      const r = await reconcileOne(row);
      results.push(r);
    } catch (error) {
      logApiError(`Reconcile transcription ${row.id} failed`, error);
      results.push({ id: row.id, action: 'crashed', message: error.message });
    }
  }
  if (results.length > 0) {
    await logAuditEvent({
      userId: null,
      organizationId: null,
      action: 'meeting.reconcile.run',
      targetType: 'system',
      targetId: 'vexa-reconcile',
      metadata: { processed: results.length, summary: results },
    });
  }
  return results;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  if (!checkSecret(req)) {
    return res.status(401).json({ code: 'UNAUTHORIZED' });
  }

  const results = await runReconcileScan();

  return res.status(200).json({ ok: true, processed: results.length, results });
}
