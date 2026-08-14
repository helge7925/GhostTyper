import { query } from './db';
import { processNextBudgetStop, releaseStaleReservations } from './budget-service';
import { abortPaidJobs, abortPaidJobsForScope } from './budget-runtime';
import { resolveVexaConfig } from './integrations';
import { decryptSecret, SECRET_CONTEXTS } from './secrets';
import { stopBot } from './api/vexa';
import { stopBridgeForTranscription } from './vexa-bridge';
import { stopInMeetingAudio } from './in-meeting-audio';
import { logError, logInfo } from './observability';

const INTERVAL_MS = Number(process.env.BUDGET_STOP_WORKER_INTERVAL_MS || 5_000);
const state = { started: false, timer: null, running: false };

async function handleStop(event) {
  const latest = await query(
    `SELECT payload, period_start, reason, organization_id, user_id
       FROM budget_stop_outbox WHERE id = $1`,
    [event.id],
  );
  const effectiveEvent = latest.rows[0] ? { ...event, ...latest.rows[0] } : event;
  const payloadIds = Array.isArray(effectiveEvent.payload?.transcriptionIds)
    ? [...effectiveEvent.payload.transcriptionIds]
    : [];
  if (!payloadIds.length && effectiveEvent.payload?.transcriptionId) {
    payloadIds.push(effectiveEvent.payload.transcriptionId);
  }
  const transcriptionIds = [...new Set(
    payloadIds.map(Number).filter(Number.isSafeInteger),
  )];
  if (effectiveEvent.payload?.scope !== 'transcription'
      && effectiveEvent.payload?.scopeAbortSuperseded !== true) {
    abortPaidJobsForScope(
      effectiveEvent.organization_id,
      effectiveEvent.user_id,
      effectiveEvent.period_start,
      effectiveEvent.reason,
    );
  }
  if (!transcriptionIds.length) return [];
  const rows = await query(
    `SELECT id, user_id, organization_id, source, meeting_platform, native_meeting_id
       FROM transcriptions
       WHERE organization_id = $1 AND id = ANY($2::integer[])
         AND budget_stop_state = 'requested'`,
    [effectiveEvent.organization_id, transcriptionIds],
  );
  abortPaidJobs(rows.rows.map((row) => row.id), effectiveEvent.reason);
  for (const row of rows.rows) {
    stopBridgeForTranscription(row.id, 'budget_stop');
    await stopInMeetingAudio({ transcriptionId: row.id, organizationId: row.organization_id });
    if (row.source !== 'vexa') continue;
    const integration = await resolveVexaConfig(row.organization_id);
    if (!integration.enabled || !integration.config?.baseUrl) {
      throw new Error(`Cannot stop Vexa meeting ${row.id}: integration unavailable.`);
    }
    const token = await query(
      `SELECT api_key_encrypted FROM vexa_user_tokens WHERE user_id = $1 AND organization_id = $2`,
      [row.user_id, row.organization_id],
    );
    if (!token.rowCount) throw new Error(`Cannot stop Vexa meeting ${row.id}: user token unavailable.`);
    const apiKey = decryptSecret(token.rows[0].api_key_encrypted, {
      field: SECRET_CONTEXTS.vexaUserToken,
      bindingId: row.organization_id,
    });
    try {
      await stopBot(
        { baseUrl: integration.config.baseUrl, apiKey },
        { platform: row.meeting_platform, nativeMeetingId: row.native_meeting_id },
      );
    } catch (error) {
      if (error.response?.status !== 404) throw error;
    }
  }
  return rows.rows.map((row) => Number(row.id));
}

async function tick() {
  if (state.running) return;
  state.running = true;
  try {
    let processed = 0;
    while (await processNextBudgetStop(handleStop)) processed += 1;
    await releaseStaleReservations({
      isTerminal: async (reservation) => {
        if (!reservation.transcription_id) return false;
        const result = await query(
          `SELECT status, budget_stop_state FROM transcriptions WHERE id = $1`,
          [reservation.transcription_id],
        );
        const row = result.rows[0];
        return Boolean(row) && (
          ['completed', 'transcribed', 'error', 'cancelled'].includes(row.status)
          || row.budget_stop_state === 'stopped'
        );
      },
    });
    if (processed) logInfo('budget_stop.processed', { processed });
  } catch (error) {
    logError('budget_stop.tick_failed', error);
  } finally {
    state.running = false;
  }
}

export function ensureBudgetStopWorkerRunning() {
  if (state.started) return;
  state.started = true;
  void tick();
  state.timer = setInterval(() => void tick(), INTERVAL_MS);
  if (state.timer.unref) state.timer.unref();
}
