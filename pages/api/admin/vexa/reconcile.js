import crypto from 'crypto';
import { query } from '../../../../lib/db';
import { logApiError } from '../../../../lib/api-utils';
import { addTranscriptionEvent } from '../../../../lib/transcription-events';
import { logAuditEvent } from '../../../../lib/audit-log';
import { resolveVexaConfig } from '../../../../lib/integrations';
import { decryptSecret } from '../../../../lib/secrets';
import { getTranscript, mapVexaTranscriptToGhostTyper } from '../../../../lib/api/vexa';
import { runManualAnalysisJob } from '../../../../lib/manual-analysis';
import { logUsage } from '../../../../lib/usage';

const STALE_MINUTES = 5;
const HARD_TIMEOUT_HOURS = 6;
const PER_RUN_LIMIT = 25;

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
            updated_at, created_at
       FROM transcriptions
      WHERE source = 'vexa'
        AND status IN ('pending', 'processing')
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
  return decryptSecret(result.rows[0].api_key_encrypted);
}

async function reconcileOne(row) {
  const ageHours = (Date.now() - new Date(row.created_at).getTime()) / 3_600_000;
  if (ageHours > HARD_TIMEOUT_HOURS) {
    await query(
      `UPDATE transcriptions SET status = 'error', bot_status = 'failed',
                                 error = 'Reconcile-Timeout (kein Webhook eingegangen)',
                                 updated_at = NOW()
        WHERE id = $1 AND status IN ('pending','processing')`,
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
      return { id: row.id, action: 'skipped_not_in_vexa' };
    }
    logApiError(`Reconcile getTranscript failed for ${row.id}`, error);
    return { id: row.id, action: 'error', message: error.message };
  }

  const meetingStatus = transcript?.meeting?.status || transcript?.status;
  const segments = Array.isArray(transcript?.segments) ? transcript.segments : [];
  if (meetingStatus !== 'completed' && meetingStatus !== 'failed' && segments.length === 0) {
    return { id: row.id, action: 'still_running' };
  }
  if (meetingStatus === 'failed') {
    await query(
      `UPDATE transcriptions SET status = 'error', bot_status = 'failed',
                                 error = 'Vexa meldet failed (Reconcile)',
                                 updated_at = NOW()
        WHERE id = $1 AND status IN ('pending','processing')`,
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
  const lock = await query(
    `UPDATE transcriptions
        SET status = 'transcribed',
            bot_status = 'completed',
            text = $1,
            segments = $2::jsonb,
            speakers = $3::jsonb,
            meeting_ended_at = COALESCE(meeting_ended_at, NOW()),
            updated_at = NOW()
      WHERE id = $4 AND status IN ('pending','processing')
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

  const lastSegment = mapped.segments.length ? mapped.segments[mapped.segments.length - 1] : null;
  const seconds = lastSegment ? Math.max(0, Math.ceil(lastSegment.end || 0)) : 0;
  if (seconds > 0) {
    await logUsage(
      row.user_id,
      'whisper-v3',
      'meeting_transcription',
      { input_tokens: seconds, output_tokens: 0 },
      row.organization_id,
    );
  }

  if (row.auto_analyze) {
    const analyzeLock = await query(
      `UPDATE transcriptions SET status = 'analyzing', updated_at = NOW()
        WHERE id = $1 AND status = 'transcribed' RETURNING id`,
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  if (!checkSecret(req)) {
    return res.status(401).json({ code: 'UNAUTHORIZED' });
  }

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

  await logAuditEvent({
    userId: null,
    organizationId: null,
    action: 'meeting.reconcile.run',
    targetType: 'system',
    targetId: 'vexa-reconcile',
    metadata: { processed: results.length, summary: results },
  });

  return res.status(200).json({ ok: true, processed: results.length, results });
}
