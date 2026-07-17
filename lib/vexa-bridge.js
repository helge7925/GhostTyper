import crypto from 'crypto';
import { query } from './db';
import { addTranscriptionEvent } from './transcription-events';
import { resolveVexaConfig } from './integrations';
import { decryptSecret, SECRET_CONTEXTS } from './secrets';
import { getTranscript, mapVexaTranscriptToGhostTyper } from './api/vexa';
import { translateTextSegments } from './ai-service';
import { resolveCortecsConfig } from './settings-service';
import { logUsage } from './usage';
import { enqueueTranslatedSegment } from './in-meeting-audio';
import { logError, logInfo } from './observability';
import { splitIntoSentenceUnits, fragmentCharLength } from './sentence-buffer';
import {
  buildGlossaryPromptBlock,
  getGlossaryForPair,
  lookupTMBatch,
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
            translation_config, audio_injection_lang
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
    await registerPollFailure(slot);
    return;
  }
  if (!context) {
    stopBridgeForTranscription(transcriptionId, 'context_missing');
    return;
  }
  // Cache identity so degraded/stale events can still be attributed on a
  // later tick where loadContext itself fails.
  slot.userId = context.row.user_id;
  slot.organizationId = context.row.organization_id;
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
    await registerPollFailure(slot, {
      userId: context.row.user_id,
      organizationId: context.row.organization_id,
    });
    return;
  }

  // Fetch succeeded — clear any backoff streak / degraded latch so the
  // cadence returns to base and a future outage can warn again.
  registerPollSuccess(slot);

  const mapped = mapVexaTranscriptToGhostTyper(transcript);
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
  await query(
    `UPDATE transcriptions
        SET segments = $1::jsonb,
            speakers = $2::jsonb,
            text = $3,
            updated_at = NOW()
      WHERE id = $4
        AND status = ANY($5::text[])`,
    [
      JSON.stringify(mapped.segments),
      JSON.stringify(mapped.speakers),
      mapped.text,
      transcriptionId,
      allowedStatuses,
    ],
  );
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
  const apiKey = cortecs.apiKey;
  if (!apiKey) {
    // No key configured — give up silently for this poll. Next poll
    // will retry; if the operator is still missing the key the user
    // will eventually see a hint in the UI (no translated_segments).
    return;
  }

  const cached = Array.isArray(slot.cachedTranslated) ? slot.cachedTranslated.slice() : [];
  let totalUsage = { input_tokens: 0, output_tokens: 0 };
  let usedModel = null;

  for (const group of groups) {
    // One source text per UNIT (concatenated segment texts), so the
    // model gets full-sentence context instead of fragments.
    const unitTexts = group.units.map((unit) =>
      unit.map((s) => s.text || '').join(' ').replace(/\s+/g, ' ').trim(),
    );
    let unitTranslations;
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
      let tmHits = new Array(unitTexts.length).fill(null);
      try {
        tmHits = await lookupTMBatch(orgId, group.sourceLang, group.targetLang, unitTexts);
      } catch (error) {
        logError('vexa_bridge.translation_memory_lookup_failed', error, { count: unitTexts.length });
      }
      for (let i = 0; i < unitTexts.length; i += 1) {
        if (tmHits[i]) {
          unitTranslations[i] = tmHits[i];
        } else {
          misses.push({ index: i, text: unitTexts[i] });
        }
      }

      if (misses.length > 0) {
        const missTexts = misses.map((entry) => entry.text);
        const relevantGlossary = selectRelevantEntries(glossary, missTexts.join('\n'));
        const glossaryBlock = buildGlossaryPromptBlock(relevantGlossary);
        const protectedTexts = missTexts.map((text) => protectDoNotTranslate(
          text,
          relevantGlossary.doNotTranslate,
          relevantGlossary.entries,
        ));
        const result = await translateTextSegments(
          protectedTexts.map((entry) => entry.masked),
          group.targetLang,
          group.sourceLang,
          apiKey,
          cortecs.chatModel,
          { glossaryBlock, baseUrl: cortecs.baseUrl, preference: cortecs.preference },
        );
        usedModel = result.model;
        totalUsage.input_tokens += Number(result.usage?.prompt_tokens || result.usage?.input_tokens || 0);
        totalUsage.output_tokens += Number(result.usage?.completion_tokens || result.usage?.output_tokens || 0);
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
      logError('vexa_bridge.translation_glossary_tm_failed', error, { count: unitTexts.length });
      try {
        const result = await translateTextSegments(
          unitTexts,
          group.targetLang,
          group.sourceLang,
          apiKey,
          cortecs.chatModel,
          { baseUrl: cortecs.baseUrl, preference: cortecs.preference },
        );
        unitTranslations = result.translations;
        usedModel = result.model;
        totalUsage.input_tokens += Number(result.usage?.prompt_tokens || result.usage?.input_tokens || 0);
        totalUsage.output_tokens += Number(result.usage?.completion_tokens || result.usage?.output_tokens || 0);
      } catch (fallbackError) {
        // Fall back to echoing the source so the translated_segments array stays
        // length-consistent with `mapped.segments` (the SSE consumer renders
        // side-by-side). Flag the entries so the UI can show them as
        // "untranslated" and — crucially — the audio-inject hook below skips
        // them: speaking the SOURCE text in the target voice would be worse
        // than silence.
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
        });
      }
    }
  }

  await query(
    `UPDATE transcriptions
        SET translated_segments = $1::jsonb,
            updated_at = NOW()
      WHERE id = $2`,
    [JSON.stringify(cached), context.row.id],
  );

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

  if (usedModel && (totalUsage.input_tokens || totalUsage.output_tokens)) {
    await logUsage(userId, usedModel, 'live_translation', totalUsage, orgId);
  }
}

export function startBridgeForTranscription(transcriptionId) {
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
