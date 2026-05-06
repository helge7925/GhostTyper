import crypto from 'crypto';
import { query } from './db';
import { addTranscriptionEvent } from './transcription-events';
import { resolveVexaConfig } from './integrations';
import { decryptSecret } from './secrets';
import { getTranscript, mapVexaTranscriptToGhostTyper } from './api/vexa';
import { translateTextSegments } from './ai-service';
import { resolveMistralApiKey } from './settings-service';
import { logUsage } from './usage';
import { logError, logInfo } from './observability';

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
    `SELECT id, user_id, organization_id, status, source, meeting_platform, native_meeting_id,
            translation_config
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
    return;
  }

  const mapped = mapVexaTranscriptToGhostTyper(transcript);
  const signature = buildSignature(mapped.segments);
  if (signature === slot.lastSignature) return;

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

/**
 * Translate the new segments since `slot.lastTranslatedIdx` and merge
 * the result into `slot.cachedTranslated`. Persists the merged array
 * to `transcriptions.translated_segments` and logs Mistral usage.
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

  // Group consecutive segments by detected source language so each
  // batch goes to the right translation direction. Voxtral fills
  // `language` per segment when it can; missing/unknown values fall
  // back to the configured `fromLang`.
  const groups = [];
  for (const seg of newSegments) {
    const detected = String(seg.language || '').slice(0, 2).toLowerCase() || null;
    const sourceLang = detected === config.toLang ? config.toLang : config.fromLang;
    const targetLang = detected === config.toLang ? config.fromLang : config.toLang;
    const last = groups[groups.length - 1];
    if (last && last.sourceLang === sourceLang && last.targetLang === targetLang) {
      last.segments.push(seg);
    } else {
      groups.push({ sourceLang, targetLang, segments: [seg] });
    }
  }

  const userId = context.row.user_id;
  const orgId = context.row.organization_id;
  const apiKey = await resolveMistralApiKey({ userId, organizationId: orgId });
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
    const texts = group.segments.map((s) => s.text || '');
    let translations;
    try {
      const result = await translateTextSegments(
        texts,
        group.targetLang,
        group.sourceLang,
        apiKey,
      );
      translations = result.translations;
      usedModel = result.model;
      totalUsage.input_tokens += Number(result.usage?.prompt_tokens || result.usage?.input_tokens || 0);
      totalUsage.output_tokens += Number(result.usage?.completion_tokens || result.usage?.output_tokens || 0);
    } catch (error) {
      // Mark the group untranslated by reusing the source text. This
      // keeps the translated_segments array length-consistent with
      // segments so the SSE consumer can render either side.
      logError('vexa_bridge.translate_segments_failed', error, { count: texts.length });
      translations = texts;
    }

    for (let i = 0; i < group.segments.length; i++) {
      const src = group.segments[i];
      cached.push({
        start: src.start,
        end: src.end,
        speaker: src.speaker,
        language: group.targetLang,
        sourceLanguage: group.sourceLang,
        text: translations[i] || '',
        sourceText: src.text || '',
      });
    }
  }

  await query(
    `UPDATE transcriptions
        SET translated_segments = $1::jsonb,
            updated_at = NOW()
      WHERE id = $2`,
    [JSON.stringify(cached), context.row.id],
  );

  slot.cachedTranslated = cached;
  slot.lastTranslatedIdx = mapped.segments.length;

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
      // Pick the next-tick cadence based on whatever pollOnce just
      // recorded for this slot. `translationActive` is set/cleared each
      // tick as a side-effect of inspecting the row's translation_config.
      const interval = current.translationActive
        ? POLL_INTERVAL_TRANSLATION_MS
        : POLL_INTERVAL_MS;
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
