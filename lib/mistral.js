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
// capability-specific fields baked in yet. When a second Mistral-backed
// feature is added, it gets its own hardcoded-model constant here, same
// shape as MISTRAL_LIVE_TRANSCRIPTION_MODEL below, reusing this same
// credential resolution.

// Chosen 2026-08-30 after a live latency comparison ruled out both
// EdenAI and (per the user, who tested it independently) OpenRouter for
// this specific capability — see
// migrate-live-meeting-stt-to-edenai/design.md for the full measurement.
// Apache-2.0 licensed (open-weight), a 4B model built specifically for
// realtime use (distinct from Mistral's batch/async transcription
// product) — not a catalogue choice, EdenAI's per-capability governance
// doesn't apply here since this bypasses EdenAI entirely.
export const MISTRAL_LIVE_TRANSCRIPTION_MODEL = 'voxtral-mini-transcribe-realtime-2602';

export function normalizeMistralConfig(config = {}) {
  return {
    schemaVersion: 1,
    apiKey: typeof config.apiKey === 'string' && config.apiKey.trim() ? config.apiKey.trim() : null,
  };
}
