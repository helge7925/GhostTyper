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
import { logUsage } from './usage';
import { addTranscriptionEvent } from './transcription-events';
import { logError, logInfo } from './observability';
import { calculateBudgetTrafficLight, resolveEffectiveBudgetLimit } from './budget-guardrails';

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
    };
    state.queues.set(transcriptionId, queue);
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

async function speakOne({ transcriptionId, organizationId, userId, segment }) {
  // Re-fetch the row so an admin who flipped the toggle off mid-queue
  // takes effect immediately on the next item.
  const rowResult = await query(
    `SELECT user_id, organization_id, source, status,
            meeting_platform, native_meeting_id,
            audio_injection_lang
       FROM transcriptions
      WHERE id = $1`,
    [transcriptionId],
  );
  const row = rowResult.rows[0];
  if (!row) return 0;
  if (row.source !== 'vexa') return 0;
  if (!['pending', 'processing'].includes(row.status)) return 0;
  if (!row.audio_injection_lang) return 0;
  // Defensive: only speak if the segment matches the configured
  // injection language. The bridge already filters this, but a
  // late-arriving queue item after a config change shouldn't slip
  // through.
  if ((segment.language || '').toLowerCase() !== row.audio_injection_lang.toLowerCase()) return 0;

  // Budget check before paying for TTS rendering.
  const overBudget = await isOverBudget(organizationId, userId);
  if (overBudget) {
    await addTranscriptionEvent({
      transcriptionId,
      userId,
      organizationId,
      stage: 'in_meeting_audio_skipped',
      message: 'Audio-Wiedergabe übersprungen: Workspace-Budget erreicht.',
    });
    return 0;
  }

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
  try {
    pcm = await voxtralTts({
      text: segment.text,
      language: row.audio_injection_lang,
      format: 'pcm',
      apiKey: mistralKey,
    });
  } catch (error) {
    logError('in_meeting_audio.tts_render_failed', error, {
      transcriptionId,
      language: row.audio_injection_lang,
    });
    return 0;
  }
  if (!pcm || pcm.length === 0) return 0;

  const audioBase64 = pcm.toString('base64');
  const seconds = estimatePcmDurationSeconds(pcm.length);

  // Log usage BEFORE sending so even a Vexa failure still incurs the
  // TTS cost we already paid for.
  await logUsage(
    row.user_id,
    'voxtral-tts-latest',
    'in_meeting_tts',
    { input_tokens: Math.ceil(seconds), output_tokens: 0 },
    organizationId,
  ).catch((err) => logError('in_meeting_audio.usage_log_failed', err));

  try {
    await botSpeak(
      { baseUrl, apiKey: vexaKey },
      {
        platform: row.meeting_platform,
        nativeMeetingId: row.native_meeting_id,
        audioBase64,
        format: 'pcm',
        sampleRate: PCM_SAMPLE_RATE,
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

async function isOverBudget(organizationId, userId) {
  try {
    // Sum the workspace's monthly cost.
    const totals = await query(
      `SELECT COALESCE(SUM(estimated_cost), 0)::numeric AS cost
         FROM usage_log
        WHERE organization_id = $1
          AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)`,
      [organizationId],
    );
    const currentCost = parseFloat(totals.rows[0]?.cost || 0);

    // Lookup limits the same way pages/api/organizations/usage.js does.
    let personalCostLimit = null;
    let personalMemberLimit = null;
    try {
      const r = await query(
        `SELECT cost_limit, member_monthly_budget_limit FROM settings WHERE user_id = $1`,
        [userId],
      );
      personalCostLimit = r.rows[0]?.cost_limit ?? null;
      personalMemberLimit = r.rows[0]?.member_monthly_budget_limit ?? null;
    } catch (error) {
      if (error?.code !== '42703' && error?.code !== '42P01') throw error;
    }
    let orgCostLimit = null;
    let orgMemberLimit = null;
    try {
      const r = await query(
        `SELECT cost_limit_cents, member_monthly_budget_limit_cents
           FROM organization_settings WHERE organization_id = $1`,
        [organizationId],
      );
      const row = r.rows[0];
      orgCostLimit = row?.cost_limit_cents != null ? Number(row.cost_limit_cents) / 100 : null;
      orgMemberLimit = row?.member_monthly_budget_limit_cents != null
        ? Number(row.member_monthly_budget_limit_cents) / 100
        : null;
    } catch (error) {
      if (error?.code !== '42703' && error?.code !== '42P01') throw error;
    }

    const limit = resolveEffectiveBudgetLimit({
      costLimit: personalCostLimit,
      memberMonthlyBudgetLimit: personalMemberLimit,
      organizationCostLimit: orgCostLimit,
      organizationMemberMonthlyBudgetLimit: orgMemberLimit,
    });
    if (limit == null) return false;
    const tl = calculateBudgetTrafficLight({
      currentCost,
      costLimit: limit,
      estimatedNextCost: 0,
    });
    return tl.level === 'red';
  } catch (error) {
    logError('in_meeting_audio.budget_check_failed', error, { organizationId });
    return false;
  }
}

/**
 * Best-effort barge-in: stop any in-flight /speak playback. Called
 * from the meeting-translation toggle when audio injection is turned
 * off mid-meeting, and from `meeting.completed` for cleanup.
 */
export async function stopInMeetingAudio({ transcriptionId, organizationId }) {
  const queue = getState().queues.get(transcriptionId);
  if (queue) queue.items = [];

  try {
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
