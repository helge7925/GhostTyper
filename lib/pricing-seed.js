// OpenRouter prices are synchronized from its live catalogue when an
// organization activates its allowlist (see lib/openrouter-pricing.js) —
// intentionally NOT seeded here, since a baked-in value would silently
// drift from that live-synced source of truth.
//
// EdenAI and Mistral have no equivalent live pricing-rate API (see
// openspec/changes/add-edenai-provider-foundation/design.md's Risks
// section) — every capability decision in the OpenRouter->EdenAI
// migration therefore left its own price row as a manual runbook task
// gating activation (see e.g. migrate-batch-transcription-to-edenai/
// tasks.md's 3.1). That's still correct for *changes* to an existing
// rate, but there's no reason a workspace should have to wait on a human
// admin action just to activate a capability for the first time when a
// real, sourced baseline rate is already known — this array seeds that
// baseline once (idempotent via seedProviderPrices' ON CONFLICT DO
// NOTHING), automatically, before any organization exists. A workspace
// that activates a capability inherits whichever price row is currently
// effective — provider_price_versions has no organization_id column, it
// is a platform-wide catalogue by design (see
// organization_price_overrides for the *opt-in* per-org override table,
// a separate concern).
//
// Every rate below was read directly from each provider's own live
// catalogue/docs on 2026-08-31 (not estimated from a third-party page),
// with the one noted exception (OCR's per-page estimate, necessarily
// derived rather than quoted, since neither provider bills OCR by the
// page). A future real price change from any vendor still needs a new,
// separately-dated row via /admin/prices — this array is a one-time
// bootstrap, not an ongoing sync (INITIAL_PRICING_EFFECTIVE_FROM never
// changes, so editing a rate here after the fact does nothing for a
// database that already ran this seed once).
const MISTRAL_SMALL_LATEST = 'mistral/mistral-small-latest';

// mistral/mistral-small-latest via EdenAI's /chat/completions — read
// live from GET /v3/models?feature=text&subfeature=chat's
// mistral/mistral-small-latest entry ("source":
// "https://mistral.ai/pricing", region "eu"): input_cost_per_token
// 1.5e-7 USD, output_cost_per_token 6e-7 USD (no EdenAI markup over
// Mistral's own direct pricing, as far as this catalogue entry shows).
// Backs seven operations that all resolve the same `chat` capability
// with the same token-based billing shape — analysis, text
// optimization, template generation, knowledge prep, and all three
// translation operations (see lib/edenai-pricing.js's
// EDENAI_OPERATIONS.chat).
const CHAT_TOKEN_RATE = {
  provider: 'edenai',
  model: MISTRAL_SMALL_LATEST,
  inputUnit: 'token',
  outputUnit: 'token',
  inputRate: 150_000, // $0.15 / million input tokens
  outputRate: 600_000, // $0.60 / million output tokens
};

export const INITIAL_PROVIDER_PRICES = [
  ...['analysis', 'text_optimization', 'template_generation', 'knowledge_prep', 'translation', 'office_translation', 'live_translation']
    .map((operation) => ({ ...CHAT_TOKEN_RATE, operation })),

  // OCR reuses the same chat/vision model, but pages/api/ocr.js and
  // pages/api/translate/file.js's OCR-fallback path both reserve and
  // commit this operation by PAGE COUNT, not by token (see those files'
  // executeReservedSpend usage-override callbacks) — so this needs its
  // own inputUnit='page' row, unlike the token-based operations above.
  // Mistral's catalogue entry has no flat per-image price field for
  // this model (vision input is tokenized, not flat-rate) — so unlike
  // every other rate in this file, this one is *derived*, not quoted:
  // a real live OCR call against a synthetic one-page business-document
  // image (2026-08-31) reported prompt_tokens=2242, completion_tokens=117.
  // At the token rates above that's ≈$0.00041/page; rounded up to
  // $0.001/page for reservation headroom against denser real documents
  // (a single synthetic sample is not a representative worst case).
  {
    provider: 'edenai', model: MISTRAL_SMALL_LATEST, operation: 'ocr',
    inputUnit: 'page', outputUnit: 'page',
    inputRate: 1_000_000_000, // $1.00 / million pages ≈ $0.001/page
    outputRate: 0,
  },

  // gladia via EdenAI's audio/speech_to_text_async — the exact $0.0102/
  // min rate already documented (and paid, live-tested) in
  // migrate-batch-transcription-to-edenai/design.md's provider
  // comparison table.
  {
    provider: 'edenai', model: 'audio/speech_to_text_async/gladia', operation: 'transcription',
    inputUnit: 'audio_second', outputUnit: 'audio_second',
    inputRate: 170_000_000, // $0.0102/min ÷ 60 sec/min × 1e6 (per-million-second basis) × 1e6 (micros/$)
    outputRate: 0,
  },

  // google/gemini-2.5-flash-tts via EdenAI's audio/tts — $0.006/min,
  // read live from GET /v3/info/audio/tts's model catalogue during the
  // TTS model comparison (migrate-tts-to-edenai/design.md). Billed by
  // audio minute upstream, but every TTS call site here reserves by
  // INPUT CHARACTER COUNT (`estimatedUsage: {outputQuantity: chars}` —
  // duration isn't known before the call completes), so this is
  // converted to a $/character estimate using that same test's own
  // measured throughput (194 chars in 11.95s ≈ 974 chars/min) — an
  // approximation of the real per-minute rate, not a vendor-quoted
  // per-character price. The real audio-duration-based cost EdenAI
  // reports per call (`usage.cost` in the sync response) is what
  // actually gets committed at settlement — see
  // lib/edenai-service.js's synthesizeSpeechEdenAi and
  // lib/pricing-core.js's calculateUsageCost reported-cost override.
  // This rate only governs the pre-flight reservation estimate.
  ...['tts', 'live_tts', 'live_tts_share', 'in_meeting_tts'].map((operation) => ({
    provider: 'edenai', model: 'audio/tts/google/gemini-2.5-flash-tts', operation,
    inputUnit: 'character', outputUnit: 'character',
    inputRate: 0,
    outputRate: 6_160_000, // ≈ $0.006/min ÷ ~974 chars/min × 1e6
  })),

  // voxtral-mini-transcribe-realtime-2602 via direct Mistral — $0.006/
  // min, confirmed against Mistral's own model docs
  // (docs.mistral.ai/models/voxtral-mini-transcribe-realtime-26-02)
  // during the Mistral pricing-gate fix (migrate-live-meeting-stt-to-
  // edenai/status.md's "Pricing gate closed" section carries the full
  // unit-conversion derivation this row's inputRate matches exactly).
  {
    provider: 'mistral', model: 'voxtral-mini-transcribe-realtime-2602', operation: 'meeting_transcription',
    inputUnit: 'audio_second', outputUnit: 'audio_second',
    inputRate: 100_000_000, // $0.006/min ÷ 60 × 1e6
    outputRate: 0,
  },
];

export const INITIAL_PRICING_EFFECTIVE_FROM = '1970-01-01T00:00:00.000Z';
