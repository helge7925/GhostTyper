import crypto from 'crypto';
import { query } from './db';
import { addTranscriptionEvent } from './transcription-events';
import { resolveVexaConfig } from './integrations';
import { decryptSecret } from './secrets';
import { getTranscript, mapVexaTranscriptToGhostTyper } from './api/vexa';
import { logError, logInfo } from './observability';

const POLL_INTERVAL_MS = 2_000;
const HARD_TIMEOUT_MS = 4 * 60 * 60 * 1000;

const STATE_KEY = '__ghosttyper_vexa_bridge__';

function getState() {
  if (!globalThis[STATE_KEY]) {
    globalThis[STATE_KEY] = { active: new Map() };
  }
  return globalThis[STATE_KEY];
}

function buildSignature(segments) {
  if (!segments.length) return 'empty';
  const last = segments[segments.length - 1];
  const head = `${segments.length}|${last.start}|${last.end}|`;
  const tailText = (last.text || '').slice(-64);
  return crypto.createHash('sha1').update(head).update(tailText).digest('hex');
}

async function loadContext(transcriptionId) {
  const result = await query(
    `SELECT id, user_id, organization_id, status, source, meeting_platform, native_meeting_id
       FROM transcriptions
      WHERE id = $1`,
    [transcriptionId],
  );
  if (!result.rows.length) return null;
  const row = result.rows[0];
  if (row.source !== 'vexa') return null;

  const integration = await resolveVexaConfig(row.organization_id);
  if (!integration.enabled || !integration.config?.baseUrl) return null;

  const tokenRow = await query(
    `SELECT api_key_encrypted FROM vexa_user_tokens WHERE user_id = $1 AND organization_id = $2`,
    [row.user_id, row.organization_id],
  );
  const apiKey = tokenRow.rows.length ? decryptSecret(tokenRow.rows[0].api_key_encrypted) : null;
  if (!apiKey) return null;

  return { row, baseUrl: integration.config.baseUrl, apiKey };
}

async function pollOnce(transcriptionId) {
  const state = getState();
  const slot = state.active.get(transcriptionId);
  if (!slot) return;

  if (Date.now() - slot.startedAt > HARD_TIMEOUT_MS) {
    stopBridgeForTranscription(transcriptionId, 'timeout');
    return;
  }

  let context;
  try {
    context = await loadContext(transcriptionId);
  } catch (error) {
    logError('vexa_bridge.load_context_failed', error);
    return;
  }
  if (!context) {
    stopBridgeForTranscription(transcriptionId, 'context_missing');
    return;
  }
  if (!['pending', 'processing'].includes(context.row.status)) {
    stopBridgeForTranscription(transcriptionId, `status=${context.row.status}`);
    return;
  }

  let transcript;
  try {
    transcript = await getTranscript(
      { baseUrl: context.baseUrl, apiKey: context.apiKey },
      { platform: context.row.meeting_platform, nativeMeetingId: context.row.native_meeting_id },
    );
  } catch (error) {
    if (error.response?.status === 404) {
      stopBridgeForTranscription(transcriptionId, 'vexa_404');
      return;
    }
    logError('vexa_bridge.fetch_failed', error);
    return;
  }

  const mapped = mapVexaTranscriptToGhostTyper(transcript);
  const signature = buildSignature(mapped.segments);
  if (signature === slot.lastSignature) return;

  await query(
    `UPDATE transcriptions
        SET segments = $1::jsonb,
            speakers = $2::jsonb,
            text = $3,
            updated_at = NOW()
      WHERE id = $4
        AND status IN ('pending','processing')`,
    [JSON.stringify(mapped.segments), JSON.stringify(mapped.speakers), mapped.text, transcriptionId],
  );
  await addTranscriptionEvent({
    transcriptionId,
    userId: context.row.user_id,
    organizationId: context.row.organization_id,
    stage: 'vexa_segment',
    message: `Live-Update: ${mapped.segments.length} Segmente.`,
    meta: { segments: mapped.segments.length },
  });

  slot.lastSignature = signature;
}

export function startBridgeForTranscription(transcriptionId) {
  const id = Number(transcriptionId);
  if (!Number.isFinite(id)) return;
  const state = getState();
  if (state.active.has(id)) return;

  const slot = {
    startedAt: Date.now(),
    lastSignature: null,
    timer: null,
  };
  state.active.set(id, slot);

  const tick = async () => {
    if (!state.active.has(id)) return;
    try {
      await pollOnce(id);
    } catch (error) {
      logError('vexa_bridge.tick_failed', error);
    }
    const current = state.active.get(id);
    if (current) {
      current.timer = setTimeout(tick, POLL_INTERVAL_MS);
      if (current.timer.unref) current.timer.unref();
    }
  };
  slot.timer = setTimeout(tick, POLL_INTERVAL_MS);
  if (slot.timer.unref) slot.timer.unref();
  logInfo('vexa_bridge.started', { transcriptionId: id });
}

export function stopBridgeForTranscription(transcriptionId, reason = 'manual') {
  const id = Number(transcriptionId);
  const state = getState();
  const slot = state.active.get(id);
  if (!slot) return;
  if (slot.timer) clearTimeout(slot.timer);
  state.active.delete(id);
  logInfo('vexa_bridge.stopped', { transcriptionId: id, reason });
}

export function isBridgeActive(transcriptionId) {
  return getState().active.has(Number(transcriptionId));
}
