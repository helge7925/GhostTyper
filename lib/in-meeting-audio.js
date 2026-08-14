import { query } from './db';
import { resolveVexaConfig } from './integrations';
import { decryptSecret, SECRET_CONTEXTS } from './secrets';
import { resolveMistralApiKey } from './settings-service';
import {
  voxtralTts,
  estimatePcmDurationSeconds,
  PCM_SAMPLE_RATE,
} from './tts';
import { botSpeak, botSpeakStop } from './api/vexa';
import {
  assertTranscriptionPaidWorkActive,
  budgetIdempotencyKey,
  composeAbortSignals,
  executeReservedSpend,
  paidJobAbortSignal,
} from './budget-runtime';
import { logError, logInfo } from './observability';

/**
 * Per-meeting FIFO queue for in-meeting TTS audio injection.
 *
 * Translation bridge → `enqueueTranslatedSegment(...)` for every new
 * translated segment whose target language matches the meeting's
 * `audio_injection_lang`. The worker drains the queue serially:
 * generate Voxtral TTS, base64-encode, POST /speak, wait
 * (estimated PCM duration + safety buffer) so the next call doesn't
 * collide with the still-playing audio.
 *
 * Backpressure: if the queue grows past `MAX_QUEUE_LAG_SECONDS` of
 * pending audio, older items are dropped — better short and current
 * than full and stale.
 *
 * Cost guardrail: before each TTS render we re-check the workspace's
 * current monthly cost vs limit and skip the call when over budget.
 * The monthly bill includes upstream STT + translate + TTS, so the
 * existing `calculateBudgetTrafficLight` helper does the right thing.
 *
 * State is held in `globalThis` (same pattern as `lib/vexa-bridge.js`)
 * so an HMR / hot-reload doesn't fork two queues against the same
 * meeting.
 */

const STATE_KEY = '__ghosttyper_in_meeting_audio__';
const SAFETY_BUFFER_MS = 500;
const MAX_QUEUE_LAG_SECONDS = 10;

function getState() {
  if (!globalThis[STATE_KEY]) {
    globalThis[STATE_KEY] = { queues: new Map() };
  }
  return globalThis[STATE_KEY];
}

function ensureQueue(transcriptionId) {
  const state = getState();
  let queue = state.queues.get(transcriptionId);
  if (!queue) {
    queue = {
      items: [],
      draining: false,
      lastSpokeAt: 0,
      controller: new AbortController(),
    };
    state.queues.set(transcriptionId, queue);
  } else if (queue.controller.signal.aborted) {
    queue.controller = new AbortController();
  }
  return queue;
}

/**
 * Public entry — called from `lib/vexa-bridge.js` after a new
 * translated segment was persisted. `segment` mirrors the shape the
 * bridge writes to `translated_segments`: `{start, end, text,
 * speaker, language, sourceLanguage, sourceText}`.
 *
 * Returns immediately; the actual Vexa POST happens in the background
 * tick. Failure modes (no API key, Vexa offline, budget exceeded) are
 * logged but never propagate up — the original segment persistence
 * stays the source of truth even if speaking fails.
 */
export function enqueueTranslatedSegment({ transcriptionId, organizationId, userId, segment }) {
  if (!segment || !segment.text || !segment.text.trim()) return;
  const queue = ensureQueue(transcriptionId);
  // Drop oldest entries when lag exceeds the cap so the audience
  // hears the latest sentence rather than catching up on stale ones.
  const pendingSeconds = queue.items.reduce(
    (sum, it) => sum + (Number(it.estDurationSec) || 4),
    0,
  );
  if (pendingSeconds > MAX_QUEUE_LAG_SECONDS) {
    const dropped = queue.items.length;
    queue.items = [];
    logInfo('in_meeting_audio.queue_drained_by_lag', { transcriptionId, dropped, pendingSeconds });
  }
  queue.items.push({
    transcriptionId,
    organizationId,
    userId,
    segment,
    signal: queue.controller.signal,
    // Cheap pre-estimate: ~15 chars/second of speech. Refined to the
    // real PCM duration once we have the bytes. Used only for queue
    // backpressure math.
    estDurationSec: Math.max(2, segment.text.length / 15),
  });
  drainQueue(transcriptionId).catch((err) =>
    logError('in_meeting_audio.drain_failed', err, { transcriptionId }),
  );
}

async function drainQueue(transcriptionId) {
  const queue = getState().queues.get(transcriptionId);
  if (!queue || queue.draining) return;
  queue.draining = true;

  try {
    while (queue.items.length > 0) {
      const item = queue.items.shift();
      let renderedSeconds = 0;
      try {
        renderedSeconds = await speakOne(item);
      } catch (error) {
        logError('in_meeting_audio.speak_one_failed', error, {
          transcriptionId,
        });
        if (['BUDGET_EXCEEDED', 'BUDGET_ACCOUNTING_UNAVAILABLE', 'PRICING_CONFIGURATION_MISSING', 'PAID_JOB_CANCELLED'].includes(error?.code)) {
          queue.items = [];
          throw error;
        }
      }
      // Wait for the audio to finish playing before the next call so
      // back-to-back segments don't collide. We pace by the PCM-duration
      // estimate plus a small safety margin.
      const waitMs = Math.round(renderedSeconds * 1000) + SAFETY_BUFFER_MS;
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  } finally {
    queue.draining = false;
  }
}

async function speakOne({ transcriptionId, organizationId, segment, signal: queueSignal }) {
  // Re-fetch the row so an admin who flipped the toggle off mid-queue
  // takes effect immediately on the next item.
  const rowResult = await query(
    `SELECT user_id, organization_id, source, status,
            meeting_platform, native_meeting_id,
             audio_injection_lang, budget_stop_state
       FROM transcriptions
      WHERE id = $1`,
    [transcriptionId],
  );
  const row = rowResult.rows[0];
  if (!row) return 0;
  if (row.source !== 'vexa') return 0;
  if (row.budget_stop_state !== 'none') return 0;
  if (!['pending', 'processing'].includes(row.status)) return 0;
  if (!row.audio_injection_lang) return 0;
  // Defensive: only speak if the segment matches the configured
  // injection language. The bridge already filters this, but a
  // late-arriving queue item after a config change shouldn't slip
  // through.
  if ((segment.language || '').toLowerCase() !== row.audio_injection_lang.toLowerCase()) return 0;

  // Resolve Mistral key (for TTS) and Vexa config (for /speak).
  const mistralKey = await resolveMistralApiKey({ userId: row.user_id, organizationId });
  if (!mistralKey) {
    logError('in_meeting_audio.no_mistral_key', null, { transcriptionId });
    return 0;
  }
  const integration = await resolveVexaConfig(organizationId);
  if (!integration.enabled || !integration.config?.baseUrl) return 0;
  const baseUrl = integration.config.baseUrl;

  const tokenRow = await query(
    `SELECT api_key_encrypted FROM vexa_user_tokens
      WHERE user_id = $1 AND organization_id = $2`,
    [row.user_id, organizationId],
  );
  const vexaKey = tokenRow.rows.length
    ? decryptSecret(tokenRow.rows[0].api_key_encrypted, {
        field: SECRET_CONTEXTS.vexaUserToken,
        bindingId: organizationId,
      })
    : null;
  if (!vexaKey) return 0;

  // Render Voxtral TTS PCM.
  let pcm;
  const activeBudgetSignal = paidJobAbortSignal(transcriptionId, {
    organizationId,
    userId: row.user_id,
  });
  const stopSignal = composeAbortSignals(queueSignal, activeBudgetSignal);
  try {
    const chars = Array.from(String(segment.text || '')).length;
    const paid = await executeReservedSpend(
      {
        idempotencyKey: budgetIdempotencyKey(
          'in-meeting-tts', transcriptionId, segment.start, segment.end, segment.speaker,
          segment.language, segment.sourceText, segment.text,
        ),
        organizationId,
        userId: row.user_id,
        transcriptionId,
        operation: 'in_meeting_tts',
        provider: 'mistral',
        model: 'voxtral-mini-tts-2603',
        estimatedUsage: { inputQuantity: 0, outputQuantity: chars },
        reservationMs: 5 * 60 * 1000,
        stopOnDenied: true,
      },
      async (_reservation, budgetSignal) => {
        const rendered = await voxtralTts({
          text: segment.text,
          language: row.audio_injection_lang,
          format: 'pcm',
          apiKey: mistralKey,
          signal: composeAbortSignals(
            stopSignal,
            budgetSignal,
          ),
        });
        return {
          pcm: rendered,
          model: 'voxtral-mini-tts-2603',
          providerRequestId: rendered.providerRequestId || null,
        };
      },
      () => ({ inputQuantity: 0, outputQuantity: chars }),
    );
    pcm = paid.pcm;
    await assertTranscriptionPaidWorkActive(transcriptionId);
  } catch (error) {
    logError('in_meeting_audio.tts_render_failed', error, {
      transcriptionId,
      language: row.audio_injection_lang,
    });
    if (['BUDGET_EXCEEDED', 'BUDGET_ACCOUNTING_UNAVAILABLE', 'PRICING_CONFIGURATION_MISSING', 'PAID_JOB_CANCELLED'].includes(error?.code)) {
      throw error;
    }
    return 0;
  }
  if (!pcm || pcm.length === 0) return 0;

  const audioBase64 = pcm.toString('base64');
  const seconds = estimatePcmDurationSeconds(pcm.length);

  try {
    await botSpeak(
      { baseUrl, apiKey: vexaKey },
      {
        platform: row.meeting_platform,
        nativeMeetingId: row.native_meeting_id,
        audioBase64,
        format: 'pcm',
        sampleRate: PCM_SAMPLE_RATE,
        signal: stopSignal,
      },
    );
    logInfo('in_meeting_audio.spoken', {
      transcriptionId,
      seconds: Number(seconds.toFixed(2)),
    });
    return seconds;
  } catch (error) {
    logError('in_meeting_audio.speak_call_failed', error, { transcriptionId });
    return 0;
  }
}

/**
 * Best-effort barge-in: stop any in-flight /speak playback. Called
 * from the meeting-translation toggle when audio injection is turned
 * off mid-meeting, and from `meeting.completed` for cleanup.
 */
export async function stopInMeetingAudio({
  transcriptionId,
  organizationId,
  baseUrl = null,
  apiKey = null,
  platform = null,
  nativeMeetingId = null,
}) {
  const queue = getState().queues.get(transcriptionId);
  if (queue) {
    queue.items = [];
    if (!queue.controller.signal.aborted) queue.controller.abort(new Error('In-meeting audio stopped.'));
  }

  try {
    if (baseUrl && apiKey && platform && nativeMeetingId) {
      await botSpeakStop(
        { baseUrl, apiKey },
        { platform, nativeMeetingId },
      );
      return;
    }
    const rowResult = await query(
      `SELECT user_id, source, meeting_platform, native_meeting_id
         FROM transcriptions WHERE id = $1`,
      [transcriptionId],
    );
    const row = rowResult.rows[0];
    if (!row || row.source !== 'vexa') return;
    const integration = await resolveVexaConfig(organizationId);
    if (!integration.enabled || !integration.config?.baseUrl) return;
    const tokenRow = await query(
      `SELECT api_key_encrypted FROM vexa_user_tokens
        WHERE user_id = $1 AND organization_id = $2`,
      [row.user_id, organizationId],
    );
    const vexaKey = tokenRow.rows.length
    ? decryptSecret(tokenRow.rows[0].api_key_encrypted, {
        field: SECRET_CONTEXTS.vexaUserToken,
        bindingId: organizationId,
      })
    : null;
    if (!vexaKey) return;
    await botSpeakStop(
      { baseUrl: integration.config.baseUrl, apiKey: vexaKey },
      { platform: row.meeting_platform, nativeMeetingId: row.native_meeting_id },
    );
  } catch (error) {
    // Common when the bot is already gone; not fatal.
    logError('in_meeting_audio.stop_failed', error, { transcriptionId });
  }
}
