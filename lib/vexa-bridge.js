import crypto from 'crypto';
import { query } from './db';
import { addTranscriptionEvent } from './transcription-events';
import { resolveVexaConfig } from './integrations';
import { decryptSecret, SECRET_CONTEXTS } from './secrets';
import { getTranscript, mapVexaTranscriptToGhostTyper, stopBot } from './api/vexa';
import { translateTextSegments } from './ai-service';
import { resolveCortecsConfig } from './settings-service';
import {
  assertTranscriptionPaidWorkActive,
  abortPaidJobs,
  budgetIdempotencyKey,
  checkpointMeetingStt,
  composeAbortSignals,
  estimateTextUsage,
  executeReservedSpend,
  paidJobAbortSignal,
} from './budget-runtime';
import { requestEmergencyBudgetStop, requestTranscriptionBudgetStop } from './budget-service';
import { enqueueTranslatedSegment, stopInMeetingAudio } from './in-meeting-audio';
import { logError, logInfo } from './observability';
import { splitIntoSentenceUnits, fragmentCharLength } from './sentence-buffer';
import {
  buildGlossaryPromptBlock,
  buildTMContextPromptBlock,
  getGlossaryForPair,
  lookupTMMatchesBatch,
  protectDoNotTranslate,
  selectRelevantEntries,
  shouldSkipTMForText,
  storeTM,
} from './translation-glossary';
import {
  computeBackoffInterval,
  decideStale,
  DEGRADED_FAILURE_THRESHOLD,
  POLL_BACKOFF_CAP_MS,
} from './vexa-bridge-utils';

// Default poll cadence: 2 s when the bot is just transcribing, 500 ms
// when live-translation is active so the companion-tab gets text and
// TTS-able segments as fast as possible. The shorter cadence is gated
// on `translation_config.enabled` so non-translating meetings stay
// gentle on Mistral's rate limits.
const POLL_INTERVAL_MS = 2_000;
const POLL_INTERVAL_TRANSLATION_MS = 500;
const HARD_TIMEOUT_MS = 4 * 60 * 60 * 1000;
// After the bot is stopped (status leaves pending/processing) we keep
// polling for a short grace window so that any segments Vexa flushes
// between "stop requested" and "container terminated" still land in our DB.
const POST_STOP_GRACE_MS = 25_000;

// Stale detector: once the bot has produced at least one segment (i.e. it
// is admitted and was transcribing), a gap this long with no new segment
// raises a one-shot "bot may be muted / removed" hint. Env-tunable; keep
// generous so a normal pause between speakers never trips it.
const STALE_AFTER_MS = Number(process.env.VEXA_STALE_AFTER_MS) || 180_000;

const STATE_KEY = '__ghosttyper_vexa_bridge__';
const PAID_WORK_STOP_CODES = new Set([
  'BUDGET_EXCEEDED',
  'BUDGET_ACCOUNTING_UNAVAILABLE',
  'PRICING_CONFIGURATION_MISSING',
  'PAID_JOB_CANCELLED',
]);
const DURABLE_EMERGENCY_STOP_CODES = new Set([
  'BUDGET_ACCOUNTING_UNAVAILABLE',
  'PRICING_CONFIGURATION_MISSING',
]);

export function isVexaBudgetSafetyError(error) {
  return PAID_WORK_STOP_CODES.has(error?.code);
}

function timestampMs(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Resolve cumulative provider audio time. Explicit provider accounting wins;
 * wall-clock elapsed and segment timestamps are progressively weaker fallbacks.
 */
export function vexaAudioElapsedSeconds(transcript, {
  meetingStartedAt = null,
  nowMs = Date.now(),
  ongoing = null,
} = {}) {
  const document = transcript && typeof transcript === 'object' ? transcript : {};
  const meeting = document.meeting && typeof document.meeting === 'object' ? document.meeting : {};
  const roots = [document, meeting, document.checkpoint, document.usage, document.data, document.data?.checkpoint];
  const providerDurations = [];
  for (const root of roots) {
    if (!root || typeof root !== 'object') continue;
    for (const key of ['audio_duration_seconds', 'audio_elapsed_seconds', 'elapsed_audio_seconds', 'elapsed_seconds', 'duration_seconds']) {
      const value = Number(root[key]);
      if (Number.isFinite(value) && value >= 0) providerDurations.push(value);
    }
  }
  if (providerDurations.length) {
    return Math.max(0, Math.ceil(Math.max(...providerDurations)));
  }

  const status = String(meeting.status || document.status || '').toLowerCase();
  const isOngoing = ongoing ?? !['completed', 'failed', 'stopped', 'cancelled'].includes(status);
  const startedAt = timestampMs(document.start_time)
    ?? timestampMs(meeting.start_time)
    ?? timestampMs(meetingStartedAt);
  const endedAt = timestampMs(document.end_time) ?? timestampMs(meeting.end_time);
  if (startedAt !== null) {
    // A final provider response may omit both duration and end_time. Silence
    // after the last segment can still be billable, so use the final call time.
    const checkpointAt = endedAt ?? (isOngoing || ongoing === false ? Number(nowMs) : null);
    if (Number.isFinite(checkpointAt) && checkpointAt >= startedAt) {
      return Math.max(0, Math.ceil((checkpointAt - startedAt) / 1000));
    }
  }

  const segmentEnds = (Array.isArray(document.segments) ? document.segments : [])
    .map((segment) => Number(segment?.end))
    .filter((end) => Number.isFinite(end) && end >= 0);
  return Math.max(0, Math.ceil(segmentEnds.length ? Math.max(...segmentEnds) : 0));
}

export async function stopVexaForBudgetFailure({
  error,
  transcriptionId,
  organizationId,
  userId,
  baseUrl,
  apiKey,
  platform,
  nativeMeetingId,
}) {
  if (!isVexaBudgetSafetyError(error)) return false;

  // Local shutdown must not depend on the same accounting database that just
  // failed. Abort first so a completed TTS render cannot start stale playback
  // after /speak/stop, then stop audio and the remote bot from cached context.
  stopBridgeForTranscription(transcriptionId, `budget_failure:${error.code}`);
  abortPaidJobs([transcriptionId], `budget_failure:${error.code}`);
  await stopInMeetingAudio({
    transcriptionId,
    organizationId,
    baseUrl,
    apiKey,
    platform,
    nativeMeetingId,
  }).catch((audioError) => {
    logError('vexa_bridge.budget_audio_stop_failed', audioError, { transcriptionId });
  });
  try {
    await stopBot(
      { baseUrl, apiKey },
      { platform, nativeMeetingId },
    );
  } catch (stopError) {
    if (stopError.response?.status !== 404) {
      logError('vexa_bridge.budget_bot_stop_failed', stopError, {
        transcriptionId,
        platform,
        nativeMeetingId,
      });
    }
  }

  try {
    await requestTranscriptionBudgetStop({
      transcriptionId,
      organizationId,
      userId,
      requestedBy: userId,
      reason: `vexa_meeting_${String(error.code).toLowerCase()}`,
    });
  } catch (stopRequestError) {
    logError('vexa_bridge.transcription_stop_request_failed', stopRequestError, {
      transcriptionId,
      organizationId,
      budgetError: error.code,
    });
  }

  if (DURABLE_EMERGENCY_STOP_CODES.has(error.code)) {
    try {
      await requestEmergencyBudgetStop({
        organizationId,
        requestedBy: userId,
        reason: `vexa_meeting_${String(error.code).toLowerCase()}`,
      });
    } catch (stopRequestError) {
      logError('vexa_bridge.budget_stop_request_failed', stopRequestError, {
        transcriptionId,
        organizationId,
        budgetError: error.code,
      });
    }
  }

  return true;
}

export async function checkpointVexaMeetingSpend({
  transcript,
  transcriptionId,
  organizationId,
  userId,
  meetingStartedAt = null,
  ongoing = true,
  final = false,
  baseUrl,
  apiKey,
  platform,
  nativeMeetingId,
}) {
  const observedSeconds = vexaAudioElapsedSeconds(transcript, { meetingStartedAt, ongoing });
  if (!final && (!observedSeconds || observedSeconds < 30)) return null;
  try {
    return await checkpointMeetingStt({
      transcriptionId,
      organizationId,
      userId,
      observedSeconds,
      final,
    });
  } catch (error) {
    if (isVexaBudgetSafetyError(error)) {
      await stopVexaForBudgetFailure({
        error,
        transcriptionId,
        organizationId,
        userId,
        baseUrl,
        apiKey,
        platform,
        nativeMeetingId,
      });
    }
    throw error;
  }
}

function getState() {
  if (!globalThis[STATE_KEY]) {
    globalThis[STATE_KEY] = { active: new Map() };
  }
  return globalThis[STATE_KEY];
}

// --- Backoff / degraded / stale bookkeeping (per slot) ---------------------

// Count a failed poll (loadContext or getTranscript threw). Widens the next
// poll interval via computeBackoffInterval and, once the failure streak
// crosses DEGRADED_FAILURE_THRESHOLD, emits exactly one `vexa_degraded`
// event. `ids` carries the user/org when the current tick has context;
// otherwise we fall back to the identity cached on a previous good tick.
async function registerPollFailure(slot, ids = null) {
  slot.consecutiveFailures = (slot.consecutiveFailures || 0) + 1;
  if (slot.consecutiveFailures < DEGRADED_FAILURE_THRESHOLD || slot.degradedEmitted) return;
  slot.degradedEmitted = true;
  const userId = ids?.userId ?? slot.userId;
  const organizationId = ids?.organizationId ?? slot.organizationId;
  if (!userId) return;
  await addTranscriptionEvent({
    transcriptionId: slot.transcriptionId,
    userId,
    organizationId,
    stage: 'vexa_degraded',
    message: 'Verbindung zu Vexa gestört — Aktualisierung verzögert, wir versuchen es weiter.',
    meta: { consecutiveFailures: slot.consecutiveFailures },
  });
}

// A successful fetch clears the backoff streak and re-arms the degraded
// event so a later outage can warn again.
function registerPollSuccess(slot) {
  slot.consecutiveFailures = 0;
  slot.degradedEmitted = false;
}

// One-shot stale warning: bot was producing segments but has gone quiet for
// longer than STALE_AFTER_MS. Cleared (and optionally a recovery event
// emitted) by the caller when a fresh segment arrives.
async function maybeEmitStale(slot) {
  const shouldWarn = decideStale({
    lastSegmentAt: slot.lastSegmentAt,
    nowMs: Date.now(),
    staleAfterMs: STALE_AFTER_MS,
    alreadyWarned: slot.staleWarned,
  });
  if (!shouldWarn) return;
  slot.staleWarned = true;
  if (!slot.userId) return;
  await addTranscriptionEvent({
    transcriptionId: slot.transcriptionId,
    userId: slot.userId,
    organizationId: slot.organizationId,
    stage: 'vexa_stale',
    message: 'Seit einigen Minuten keine neuen Wortmeldungen — der Bot ist evtl. stummgeschaltet oder wurde aus dem Meeting entfernt.',
    meta: { staleAfterMs: STALE_AFTER_MS },
  });
}

function buildSignature(segments) {
  if (!segments.length) return 'empty';
  const last = segments[segments.length - 1];
  // Include the total text length so revisions of EARLIER segments (Vexa
  // may re-emit corrected text without changing count or last segment)
  // still change the signature and get persisted.
  let totalChars = 0;
  for (const segment of segments) totalChars += (segment.text || '').length;
  const head = `${segments.length}|${totalChars}|${last.start}|${last.end}|`;
  const tailText = (last.text || '').slice(-64);
  return crypto.createHash('sha1').update(head).update(tailText).digest('hex');
}

async function loadContext(transcriptionId) {
  const result = await query(
    `SELECT id, user_id, organization_id, status, source, meeting_platform, native_meeting_id,
             translation_config, audio_injection_lang, budget_stop_state, meeting_started_at
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
  const apiKey = tokenRow.rows.length
    ? decryptSecret(tokenRow.rows[0].api_key_encrypted, {
        field: SECRET_CONTEXTS.vexaUserToken,
        bindingId: row.organization_id,
      })
    : null;
  if (!apiKey) return null;

  return { row, baseUrl: integration.config.baseUrl, apiKey };
}

function stopContextFromLoadedContext(context) {
  const row = context?.row;
  if (row?.source !== 'vexa') return null;
  if (!row.user_id || !row.organization_id || !context.baseUrl || !context.apiKey
      || !row.meeting_platform || !row.native_meeting_id) return null;
  return {
    source: 'vexa',
    userId: row.user_id,
    organizationId: row.organization_id,
    baseUrl: context.baseUrl,
    apiKey: context.apiKey,
    platform: row.meeting_platform,
    nativeMeetingId: row.native_meeting_id,
  };
}

function normalizeInitialStopContext(context) {
  if (context?.source !== 'vexa') return null;
  if (!context.userId || !context.organizationId || !context.baseUrl || !context.apiKey
      || !context.platform || !context.nativeMeetingId) return null;
  return {
    source: 'vexa',
    userId: context.userId,
    organizationId: context.organizationId,
    baseUrl: context.baseUrl,
    apiKey: context.apiKey,
    platform: context.platform,
    nativeMeetingId: context.nativeMeetingId,
  };
}

async function stopForUnavailableAccounting(slot) {
  const context = slot.stopContext;
  if (!context) return false;
  const error = Object.assign(new Error('Vexa accounting context is unavailable.'), {
    code: 'BUDGET_ACCOUNTING_UNAVAILABLE',
  });
  await stopVexaForBudgetFailure({
    error,
    transcriptionId: slot.transcriptionId,
    ...context,
  });
  return true;
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
    if (await stopForUnavailableAccounting(slot)) return;
    await registerPollFailure(slot);
    return;
  }
  if (!context) {
    if (await stopForUnavailableAccounting(slot)) return;
    stopBridgeForTranscription(transcriptionId, 'context_missing');
    return;
  }
  // Cache identity so degraded/stale events can still be attributed on a
  // later tick where loadContext itself fails.
  slot.userId = context.row.user_id;
  slot.organizationId = context.row.organization_id;
  slot.stopContext = stopContextFromLoadedContext(context) ?? slot.stopContext;
  if (context.row.budget_stop_state !== 'none') {
    stopBridgeForTranscription(transcriptionId, 'budget_stop');
    return;
  }
  if (!['pending', 'processing'].includes(context.row.status)) {
    // Allow a short grace window after status has left pending/processing
    // (e.g. reconcile already finalized) so any trailing segments Vexa
    // emits while the bot container is winding down still get persisted.
    if (!slot.graceUntil) {
      slot.graceUntil = Date.now() + POST_STOP_GRACE_MS;
    }
    if (Date.now() >= slot.graceUntil) {
      stopBridgeForTranscription(transcriptionId, `status=${context.row.status}`);
      return;
    }
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
    await stopVexaForBudgetFailure({
      error: Object.assign(new Error('Vexa usage checkpoint is unavailable.'), {
        code: 'BUDGET_ACCOUNTING_UNAVAILABLE',
        cause: error,
      }),
      transcriptionId,
      organizationId: context.row.organization_id,
      userId: context.row.user_id,
      baseUrl: context.baseUrl,
      apiKey: context.apiKey,
      platform: context.row.meeting_platform,
      nativeMeetingId: context.row.native_meeting_id,
    });
    return;
  }

  // Fetch succeeded — clear any backoff streak / degraded latch so the
  // cadence returns to base and a future outage can warn again.
  registerPollSuccess(slot);

  const mapped = mapVexaTranscriptToGhostTyper(transcript);
  await checkpointVexaMeetingSpend({
    transcript,
    transcriptionId,
    organizationId: context.row.organization_id,
    userId: context.row.user_id,
    meetingStartedAt: context.row.meeting_started_at,
    ongoing: true,
    baseUrl: context.baseUrl,
    apiKey: context.apiKey,
    platform: context.row.meeting_platform,
    nativeMeetingId: context.row.native_meeting_id,
  });
  const signature = buildSignature(mapped.segments);
  if (signature === slot.lastSignature) {
    // No new segment this tick. If the bot had been producing and has now
    // gone quiet past the threshold, surface a one-shot stale hint.
    await maybeEmitStale(slot);
    return;
  }

  // Refresh the stale clock only for real segments — an empty first poll
  // (signature 'empty' vs the initial null) must not arm the stale
  // detector; a never-producing bot is the reconcile join-timeout's job.
  if (mapped.segments.length > 0) {
    slot.lastSegmentAt = Date.now();
    if (slot.staleWarned) {
      // Bot is talking again — clear the warning and emit a recovery note.
      slot.staleWarned = false;
      await addTranscriptionEvent({
        transcriptionId,
        userId: context.row.user_id,
        organizationId: context.row.organization_id,
        stage: 'vexa_recovered',
        message: 'Wortmeldungen kommen wieder an — der Bot transkribiert weiter.',
      });
    }
  }

  // Normally only update while still in pending/processing. During the
  // post-stop grace window we also allow updates on transcribed rows so
  // late chunks aren't dropped. We never overwrite analysis state
  // (analyzing/completed/error) — those mean the user already moved on.
  const allowedStatuses = slot.graceUntil
    ? ['pending', 'processing', 'transcribed']
    : ['pending', 'processing'];
  const persisted = await query(
    `UPDATE transcriptions
        SET segments = $1::jsonb,
            speakers = $2::jsonb,
            text = $3,
            updated_at = NOW()
      WHERE id = $4
        AND budget_stop_state = 'none'
        AND status = ANY($5::text[])`,
    [
      JSON.stringify(mapped.segments),
      JSON.stringify(mapped.speakers),
      mapped.text,
      transcriptionId,
      allowedStatuses,
    ],
  );
  if (!persisted.rowCount) {
    stopBridgeForTranscription(transcriptionId, 'budget_stop_race');
    return;
  }
  await addTranscriptionEvent({
    transcriptionId,
    userId: context.row.user_id,
    organizationId: context.row.organization_id,
    stage: 'vexa_segment',
    message: `Live-Update: ${mapped.segments.length} Segmente.`,
    meta: { segments: mapped.segments.length },
  });

  // Track whether translation is active so the next-tick scheduler
  // can pick the shorter polling interval for translation meetings.
  slot.translationActive = !!context.row.translation_config?.enabled;

  // Live-translation hook: only translate the delta (segments past the
  // last-translated index) so we don't re-pay the full transcript every
  // poll. A translation failure must NEVER block the original-segment
  // persistence above — we already committed the source-of-truth.
  if (context.row.translation_config?.enabled) {
    try {
      await runTranslationDelta({ slot, context, mapped });
    } catch (error) {
      logError('vexa_bridge.translation_failed', error, { transcriptionId });
      if (isVexaBudgetSafetyError(error)) {
        await stopVexaForBudgetFailure({
          error,
          transcriptionId,
          organizationId: context.row.organization_id,
          userId: context.row.user_id,
          baseUrl: context.baseUrl,
          apiKey: context.apiKey,
          platform: context.row.meeting_platform,
          nativeMeetingId: context.row.native_meeting_id,
        });
        return;
      }
      // do not rethrow — the next poll tick will retry the same delta.
    }
  }

  slot.lastSignature = signature;
}

// Voxtral STT chunks audio aggressively (every couple of seconds), so a
// segment is rarely a full sentence — often just `"und dann sagte er,"`.
// Translating each chunk in isolation produces choppy output and forces
// the TTS to emit half-sentences. We accumulate consecutive same-direction
// segments until the buffer ends with a sentence terminator, only then
// fire the translation (see `lib/sentence-buffer.js` for the pure
// helpers). Safety flush: if a fragment stays incomplete for more than
// this many seconds OR exceeds this many characters, translate it anyway
// so the audience doesn't fall too far behind.
const FRAGMENT_FLUSH_AFTER_MS = 8_000;
const FRAGMENT_FLUSH_CHAR_LIMIT = 280;
// Glossary entries are re-fetched after this TTL so mid-meeting edits in the
// admin UI take effect without waiting for the next meeting.
const GLOSSARY_CACHE_TTL_MS = 60_000;

/**
 * Translate the new segments since `slot.lastTranslatedIdx` and merge
 * the result into `slot.cachedTranslated`. Persists the merged array
 * to `transcriptions.translated_segments` and logs Mistral usage.
 *
 * Translation is sentence-aware: we batch consecutive STT segments
 * until the running concatenation ends with a sentence terminator,
 * then translate that batch as one unit (better grammar, better TTS
 * phrasing). Fragments without a terminator are held back for the
 * next poll unless a safety threshold trips.
 *
 * Auto-detect: if Voxtral reports a segment in the configured `toLang`
 * (i.e. the speaker just spoke the destination language), we flip the
 * direction for that segment so a bilingual conversation translates
 * both sides.
 */
async function runTranslationDelta({ slot, context, mapped }) {
  const config = context.row.translation_config;
  const startIdx = slot.lastTranslatedIdx ?? 0;
  const newSegments = mapped.segments.slice(startIdx);
  if (newSegments.length === 0) return;

  // Step 1: split into complete sentence units + a possibly-incomplete
  // trailing fragment.
  const { complete: sentenceUnits, trailing } = splitIntoSentenceUnits(newSegments);

  // Step 2: decide what to do with the trailing fragment.
  //   - If a sentence terminator has shown up since the last flush, fine —
  //     leave the fragment for the next poll.
  //   - Otherwise check the safety thresholds: too old / too long → flush
  //     anyway so the listener doesn't fall a paragraph behind the speaker.
  if (trailing.length > 0) {
    const now = Date.now();
    if (!slot.fragmentStartedAt) slot.fragmentStartedAt = now;
    const tooOld = now - slot.fragmentStartedAt > FRAGMENT_FLUSH_AFTER_MS;
    const tooLong = fragmentCharLength(trailing) > FRAGMENT_FLUSH_CHAR_LIMIT;
    if (tooOld || tooLong) {
      sentenceUnits.push(trailing);
      slot.fragmentStartedAt = null;
    }
  } else {
    slot.fragmentStartedAt = null;
  }

  // Nothing translation-ready this tick? Bail without advancing
  // `lastTranslatedIdx`; the same segments will be re-evaluated next
  // poll along with any new ones.
  if (sentenceUnits.length === 0) return;

  // For each sentence unit, pick a translation direction from the
  // FIRST segment's detected language (sentences are essentially
  // monolingual; mid-sentence language switches would be Voxtral
  // mis-tagging, not a real bilingual conversation).
  const unitsWithDirection = sentenceUnits.map((unit) => {
    const detected = String(unit[0]?.language || '').slice(0, 2).toLowerCase() || null;
    const sourceLang = detected === config.toLang ? config.toLang : config.fromLang;
    const targetLang = detected === config.toLang ? config.fromLang : config.toLang;
    return { unit, sourceLang, targetLang };
  });

  // Group consecutive same-direction units together so we can make ONE
  // Mistral round-trip per direction even when the speaker says
  // multiple sentences in a row.
  const groups = [];
  for (const entry of unitsWithDirection) {
    const last = groups[groups.length - 1];
    if (last && last.sourceLang === entry.sourceLang && last.targetLang === entry.targetLang) {
      last.units.push(entry.unit);
    } else {
      groups.push({ sourceLang: entry.sourceLang, targetLang: entry.targetLang, units: [entry.unit] });
    }
  }

  const userId = context.row.user_id;
  const orgId = context.row.organization_id;
  const cortecs = await resolveCortecsConfig({ userId, organizationId: orgId });
  if (!cortecs.apiKey) {
    // No key configured — give up silently for this poll. Next poll
    // will retry; if the operator is still missing the key the user
    // will eventually see a hint in the UI (no translated_segments).
    return;
  }
  const signal = paidJobAbortSignal(context.row.id, { organizationId: orgId, userId });

  const cached = Array.isArray(slot.cachedTranslated) ? slot.cachedTranslated.slice() : [];
  for (const group of groups) {
    // One source text per UNIT (concatenated segment texts), so the
    // model gets full-sentence context instead of fragments.
    const unitTexts = group.units.map((unit) =>
      unit.map((s) => s.text || '').join(' ').replace(/\s+/g, ' ').trim(),
    );
    let unitTranslations;
    let unitTmMatches = new Array(unitTexts.length).fill(null);
    let translationFailed = false;
    try {
      const cacheKey = `${group.sourceLang}:${group.targetLang}`;
      slot.glossaryCache = slot.glossaryCache || {};
      const cachedGlossary = slot.glossaryCache[cacheKey];
      if (!cachedGlossary || cachedGlossary.expiresAt <= Date.now()) {
        slot.glossaryCache[cacheKey] = {
          // Live meetings use the meeting owner's personal glossary merged
          // with the workspace tier (userId from the transcription row).
          value: await getGlossaryForPair(orgId, group.sourceLang, group.targetLang, { userId }),
          expiresAt: Date.now() + GLOSSARY_CACHE_TTL_MS,
        };
      }
      const glossary = slot.glossaryCache[cacheKey].value;
      unitTranslations = new Array(unitTexts.length).fill(null);
      const misses = [];
      try {
        unitTmMatches = await lookupTMMatchesBatch(
          orgId,
          group.sourceLang,
          group.targetLang,
          unitTexts,
          { glossary },
        );
      } catch (error) {
        logError('vexa_bridge.translation_memory_lookup_failed', error, { count: unitTexts.length });
      }
      for (let i = 0; i < unitTexts.length; i += 1) {
        if (unitTmMatches[i]?.autoReusable) {
          unitTranslations[i] = unitTmMatches[i].targetText;
        } else {
          misses.push({
            index: i,
            text: unitTexts[i],
            tmSuggestions: unitTmMatches[i] ? [unitTmMatches[i]] : [],
          });
        }
      }

      if (misses.length > 0) {
        const missTexts = misses.map((entry) => entry.text);
        const relevantGlossary = selectRelevantEntries(glossary, missTexts.join('\n'));
        const glossaryBlock = [
          buildGlossaryPromptBlock(relevantGlossary),
          buildTMContextPromptBlock(misses.flatMap((entry) => entry.tmSuggestions)),
        ].filter(Boolean).join('\n\n');
        const protectedTexts = missTexts.map((text) => protectDoNotTranslate(
          text,
          relevantGlossary.doNotTranslate,
          relevantGlossary.entries,
        ));
        const paidTexts = protectedTexts.map((entry) => entry.masked);
        await assertTranscriptionPaidWorkActive(context.row.id);
        const groupIdentity = budgetIdempotencyKey(
          'live-translation-batch',
          context.row.id,
          startIdx,
          group.sourceLang,
          group.targetLang,
          group.units.map((unit, index) => [unit[0]?.start, unit[unit.length - 1]?.end, unitTexts[index]]),
        );
        const result = await executeReservedSpend(
          {
            idempotencyKey: `${groupIdentity}:guarded`,
            organizationId: orgId,
            userId,
            transcriptionId: context.row.id,
            operation: 'live_translation',
            provider: 'cortecs',
            model: cortecs.chatModel,
            estimatedUsage: estimateTextUsage(paidTexts.join('\n'), {
              inputBufferTokens: 320,
              outputMultiplier: 1.3,
              outputBufferTokens: 160,
            }),
            reservationMs: 5 * 60 * 1000,
            stopOnDenied: true,
          },
          (_reservation, budgetSignal) => translateTextSegments(
            paidTexts,
            group.targetLang,
            group.sourceLang,
            cortecs.apiKey,
            cortecs.chatModel,
            {
              glossaryBlock,
              baseUrl: cortecs.baseUrl,
              preference: cortecs.preference,
              signal: composeAbortSignals(signal, budgetSignal),
            },
          ),
        );
        for (let i = 0; i < misses.length; i += 1) {
          const restored = protectedTexts[i].restore(result.translations[i] || '');
          unitTranslations[misses[i].index] = restored;
          // TM leak guard: never cache a segment shaped by the meeting owner's
          // personal glossary into the org-wide translation memory.
          if (!shouldSkipTMForText(glossary, misses[i].text)) {
            try {
              await storeTM(orgId, group.sourceLang, group.targetLang, misses[i].text, restored);
            } catch (error) {
              logError('vexa_bridge.translation_memory_store_failed', error, { index: i });
            }
          }
        }
      }
    } catch (error) {
      if (['BUDGET_EXCEEDED', 'BUDGET_ACCOUNTING_UNAVAILABLE', 'PRICING_CONFIGURATION_MISSING', 'PAID_JOB_CANCELLED'].includes(error?.code)) {
        throw error;
      }
      logError('vexa_bridge.translation_glossary_tm_failed', error, { count: unitTexts.length });
      try {
        await assertTranscriptionPaidWorkActive(context.row.id);
        const fallbackKey = budgetIdempotencyKey(
          'live-translation-fallback',
          context.row.id,
          startIdx,
          group.sourceLang,
          group.targetLang,
          group.units.map((unit) => [unit[0]?.start, unit[unit.length - 1]?.end]),
        );
        const result = await executeReservedSpend(
          {
            idempotencyKey: fallbackKey,
            organizationId: orgId,
            userId,
            transcriptionId: context.row.id,
            operation: 'live_translation',
            provider: 'cortecs',
            model: cortecs.chatModel,
            estimatedUsage: estimateTextUsage(unitTexts.join('\n'), {
              inputBufferTokens: 320,
              outputMultiplier: 1.3,
              outputBufferTokens: 160,
            }),
            reservationMs: 5 * 60 * 1000,
            stopOnDenied: true,
          },
          (_reservation, budgetSignal) => translateTextSegments(
            unitTexts,
            group.targetLang,
            group.sourceLang,
            cortecs.apiKey,
            cortecs.chatModel,
            {
              baseUrl: cortecs.baseUrl,
              preference: cortecs.preference,
              signal: composeAbortSignals(signal, budgetSignal),
            },
          ),
        );
        unitTranslations = result.translations;
      } catch (fallbackError) {
        if (['BUDGET_EXCEEDED', 'BUDGET_ACCOUNTING_UNAVAILABLE', 'PRICING_CONFIGURATION_MISSING', 'PAID_JOB_CANCELLED'].includes(fallbackError?.code)) {
          throw fallbackError;
        }
        // Fall back to echoing the source so the translated_segments array stays
        // length-consistent with `mapped.segments`; audio-inject skips failed entries.
        logError('vexa_bridge.translate_segments_failed', fallbackError, { count: unitTexts.length });
        unitTranslations = unitTexts;
        translationFailed = true;
      }
    }

    // Distribute: attach the full sentence translation to the LAST
    // segment of each unit, leave earlier segments with empty
    // translation text. The UI is already tolerant of empty rows; the
    // audio queue down-stream skips empty entries automatically.
    for (let u = 0; u < group.units.length; u++) {
      const unit = group.units[u];
      const translation = unitTranslations[u] || '';
      const tmCandidate = unitTmMatches[u];
      for (let i = 0; i < unit.length; i++) {
        const src = unit[i];
        const isLast = i === unit.length - 1;
        cached.push({
          start: src.start,
          end: src.end,
          speaker: src.speaker,
          language: group.targetLang,
          sourceLanguage: group.sourceLang,
          text: isLast ? translation : '',
          sourceText: src.text || '',
          // `true` only when Mistral translation failed and we echoed
          // the source. The audio-inject hook skips these so the bot
          // never reads untranslated source text aloud.
          translationFailed,
          translationMemoryMatch: isLast && tmCandidate?.autoReusable ? tmCandidate : null,
          translationMemorySuggestions: isLast && tmCandidate && !tmCandidate.autoReusable
            ? [tmCandidate]
            : [],
        });
      }
    }
  }

  const translatedPersisted = await query(
    `UPDATE transcriptions
        SET translated_segments = $1::jsonb,
            updated_at = NOW()
      WHERE id = $2 AND budget_stop_state = 'none'`,
    [JSON.stringify(cached), context.row.id],
  );
  if (!translatedPersisted.rowCount) {
    stopBridgeForTranscription(context.row.id, 'budget_stop_race');
    return;
  }
  // Phase-2 audio-injection hook: enqueue every newly-added segment
  // whose target language matches the meeting's audio_injection_lang.
  // Only the segments produced in THIS delta — the loop above already
  // guarantees those are the ones just appended to `cached`. The
  // queue worker handles its own pacing + budget guardrail; we just
  // hand it the data.
  const injectionLang = (context.row.audio_injection_lang || '').toLowerCase();
  if (injectionLang) {
    // Index where the new segments start in `cached` is exactly the
    // total segment count before the loop — that's
    // `slot.cachedTranslated?.length || 0`.
    const startIdx = (slot.cachedTranslated || []).length;
    for (let i = startIdx; i < cached.length; i++) {
      const seg = cached[i];
      // Skip failed-translation entries — their `text` is the untranslated
      // source, and reading that aloud in the target voice is worse than
      // staying silent for that segment.
      if (seg.translationFailed) continue;
      if ((seg.language || '').toLowerCase() === injectionLang) {
        enqueueTranslatedSegment({
          transcriptionId: context.row.id,
          organizationId: orgId,
          userId,
          segment: seg,
        });
      }
    }
  }

  slot.cachedTranslated = cached;
  // Advance the cursor only past segments we actually translated this
  // tick. If a trailing fragment is being held back for the next poll,
  // those segments must be re-evaluated alongside the upcoming ones.
  const translatedThisTick = sentenceUnits.reduce((sum, u) => sum + u.length, 0);
  slot.lastTranslatedIdx = startIdx + translatedThisTick;

}

export function startBridgeForTranscription(transcriptionId, initialContext = null) {
  const id = Number(transcriptionId);
  if (!Number.isFinite(id)) return;
  const state = getState();
  if (state.active.has(id)) return;

  const slot = {
    transcriptionId: id,
    startedAt: Date.now(),
    lastSignature: null,
    timer: null,
    // Backoff + degraded state.
    consecutiveFailures: 0,
    degradedEmitted: false,
    // Stale detector state. lastSegmentAt stays null until the first real
    // segment so a never-admitted bot is handled by the reconcile
    // join-timeout, not mislabelled as "stale".
    lastSegmentAt: null,
    staleWarned: false,
    // Identity cached from the first successful loadContext so degraded /
    // stale events can be attributed even on a tick where the DB read fails.
    userId: null,
    organizationId: null,
    stopContext: normalizeInitialStopContext(initialContext),
  };
  state.active.set(id, slot);

  const tick = async () => {
    if (!state.active.has(id)) return;
    try {
      await pollOnce(id);
    } catch (error) {
      logError('vexa_bridge.tick_failed', error);
      if (isVexaBudgetSafetyError(error)) {
        stopBridgeForTranscription(id, 'paid_work_blocked');
      }
    }
    const current = state.active.get(id);
    if (current) {
      // Pick the next-tick base cadence based on whatever pollOnce just
      // recorded for this slot. `translationActive` is set/cleared each
      // tick as a side-effect of inspecting the row's translation_config.
      const baseInterval = current.translationActive
        ? POLL_INTERVAL_TRANSLATION_MS
        : POLL_INTERVAL_MS;
      // Exponential backoff on consecutive poll failures (base → cap 60s);
      // 0 failures yields the unchanged base cadence for healthy meetings.
      const interval = computeBackoffInterval(
        current.consecutiveFailures || 0,
        baseInterval,
        POLL_BACKOFF_CAP_MS,
      );
      current.timer = setTimeout(tick, interval);
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
