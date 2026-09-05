// Direct Mistral integration — deliberately NOT routed through EdenAI or
// OpenRouter's aggregation layers. Exists for exactly one reason so far:
// live-meeting speech-to-text needs genuine low-latency streaming, which
// neither EdenAI (async job model, measured 3.5-8.6s round-trip for a
// ~2s chunk — see migrate-live-meeting-stt-to-edenai/design.md) nor
// OpenRouter (not meaningfully faster, per the user) can offer. Mistral's
// own `/v1/audio/transcriptions/realtime` WebSocket endpoint measured
// 0.76-1.5s for chunks up to ~6s, comfortably inside Vexa's ~2-3s chunk
// cadence.
//
// Deliberately generic (not named/shaped as STT-only): the user asked
// this be usable for live-meeting *translation* too later, so
// `normalizeMistralConfig`/`resolveMistralConfig` (lib/settings-service.js)
// only carry what's provider-generic (an API key) — no
// capability-specific fields baked in yet. That second consumer now
// exists (MISTRAL_TRANSLATION_MODEL below, used by
// lib/mistral-service.js's translateTextSegmentsMistral for live-meeting
// translation) and needed exactly zero changes to the credential layer,
// which is what that genericity was for.

// Chosen 2026-08-30 after a live latency comparison ruled out both
// EdenAI and (per the user, who tested it independently) OpenRouter for
// this specific capability — see
// migrate-live-meeting-stt-to-edenai/design.md for the full measurement.
// Apache-2.0 licensed (open-weight), a 4B model built specifically for
// realtime use (distinct from Mistral's batch/async transcription
// product) — not a catalogue choice, EdenAI's per-capability governance
// doesn't apply here since this bypasses EdenAI entirely.
export const MISTRAL_LIVE_TRANSCRIPTION_MODEL = 'voxtral-mini-transcribe-realtime-2602';

// Live-meeting translation, added 2026-09-01. Deliberately the SAME model
// EdenAI's `chat` capability already routes translation through
// (`mistral/mistral-small-latest` there, unprefixed here since we're
// talking to Mistral directly) — so this is a pure transport change, not
// a new model decision: the translation-quality comparison in
// migrate-translation-to-edenai/design.md (5 dedicated MT engines vs.
// chat, glossary/placeholder handling, markdown preservation) already
// validated this exact model for this exact prompt, and none of that
// evidence depends on whether the bytes travel via EdenAI's aggregation
// layer or straight to Mistral. See migrate-live-meeting-translation-to-
// mistral/design.md for the latency measurement that motivated the
// switch, and for why the EdenAI/OpenRouter path is kept as a fallback
// here (unlike live STT, which is Mistral-exclusive) — translation
// through EdenAI works today and is only slower, not broken.
export const MISTRAL_TRANSLATION_MODEL = 'mistral-small-latest';

export const MISTRAL_BASE_URL = 'https://api.mistral.ai/v1';

// Live-meeting translation runs inside lib/vexa-bridge.js's poll tick, so
// a hung request stalls that meeting's translation loop until it clears.
// 30s is a generous outer bound for a call that measured ~1s — not a
// target, a backstop.
const MISTRAL_HTTP_TIMEOUT_MS = Number.parseInt(process.env.MISTRAL_HTTP_TIMEOUT_MS, 10) || 30_000;

export class MistralError extends Error {
  constructor(message, { status = 500, code = 'MISTRAL_ERROR', details = null } = {}) {
    super(message);
    this.name = 'MistralError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function normalizeMistralConfig(config = {}) {
  return {
    schemaVersion: 1,
    apiKey: typeof config.apiKey === 'string' && config.apiKey.trim() ? config.apiKey.trim() : null,
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  return fetch(url, { ...options, signal });
}

// Mirrors lib/edenai.js's edenAiJsonRequest — Mistral's REST API is
// OpenAI-compatible, so the request/response shape is identical to what
// the EdenAI adapter already builds; only the host and auth differ. Plain
// fetch rather than safeFetch (lib/network-guard.js) matches
// edenAiJsonRequest's precedent: the URL is a fixed compile-time constant,
// never provider-returned, so there is no SSRF surface to guard (unlike
// synthesizeSpeechEdenAi's CDN download, which does use safeFetch).
export async function mistralJsonRequest(path, body, apiKey, { timeoutMs = MISTRAL_HTTP_TIMEOUT_MS, signal = null } = {}) {
  if (!apiKey) throw new MistralError('Mistral API key is not configured.', { status: 400, code: 'NO_API_KEY' });
  const response = await fetchWithTimeout(`${MISTRAL_BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }, timeoutMs);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new MistralError(`Mistral request failed (${response.status}).`, {
      status: response.status,
      code: response.status === 404 ? 'MODEL_UNAVAILABLE' : 'MISTRAL_REQUEST_FAILED',
      details: detail.slice(0, 500),
    });
  }
  return response.json();
}
