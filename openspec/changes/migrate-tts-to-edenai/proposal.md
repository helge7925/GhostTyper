# Change: Migrate Text-To-Speech To EdenAI

## Why

`lib/tts.js`'s `openRouterTts` renders every spoken-audio feature this
app has (in-meeting audio injection, live read-aloud during a
transcription, the same for share links) via OpenRouter's
`/audio/speech` endpoint. This is the last of the four originally-planned
EdenAI capability decisions still open (`chat`, `transcription`,
`translation`→chat and `ocr`→chat were already decided;
`liveTranscription` was permanently excluded in favor of a direct Mistral
integration — see `migrate-live-meeting-stt-to-edenai`). Per the
`hardcode-edenai-models` philosophy, TTS needed its own real comparison
test before a model could be hardcoded.

Pulled out of the originally-planned
`migrate-chat-tts-and-decommission-openrouter` bundle into its own
change, same reasoning already applied to every other capability this
session: TTS's outcome depends only on its own live comparison, not on
the (separate, much larger, not-yet-started) chat migration and full
OpenRouter decommission that change also covers.

Live comparison (2026-08-30) tested every EdenAI TTS model with an EU
region — `amazon/standard`, `amazon/neural`, `google/wavenet`,
`google/neural2`, `microsoft/neural`, `google/gemini-2.5-flash-tts` —
against the same German test text; `elevenlabs`/`deepgram`/`openai`/
`lovoai` are US-only and were excluded before any quality comparison,
per the standing cost/EU-region rule.

A real pitfall surfaced first: EdenAI's per-provider default voice (no
explicit `voice` field) produced garbled or partly-wrong German for
nearly every candidate, confirmed by feeding each sample back through
the app's already-verified `gladia` transcription and diffing against
the source text. Re-run with an explicit, known-good German voice id
fixed this for every candidate except `microsoft/neural`
(`de-DE-KatjaNeural`), which still corrupted a money amount ("12.500
Euro" → "12.000 aus in 500 Euro") — a defect on financial figures
specifically, disqualifying regardless of price.

That round-trip check proves intelligibility, not naturalness — an ASR
model transcribes flat, robotic "standard"-tier speech just as correctly
as fluent speech, so it cannot answer the actual question of which voice
sounds acceptable for a real user to listen to. The three cheapest,
round-trip-correct, EU-region candidates (normalized to $/1000
characters: `amazon/standard`/`google/wavenet` tied at $0.004,
`gemini-2.5-flash-tts` at ~$0.0062) were sent to the user as real audio
samples for an actual listening comparison — the one judgment this
text-based test methodology cannot make itself. The user chose
`google/gemini-2.5-flash-tts` with voice `"Kore"`: a modern, LLM-based
synthesis model, EU region, only marginally pricier than the bottom
tier.

## What Changes

- `lib/edenai.js`: `EDENAI_HARDCODED_MODEL.tts` set to
  `'audio/tts/google/gemini-2.5-flash-tts'` (was `null`). New
  `EDENAI_TTS_DEFAULT_VOICE = 'Kore'` constant — the built-in fallback
  voice used whenever a workspace hasn't set its own
  `ttsVoices[model]` override.
- `lib/edenai-service.js` gains `synthesizeSpeechEdenAi`, mirroring
  `openRouterTts`'s exact contract (a `Buffer` with `.providerRequestId`/
  `.usage` attached) so call sites branch on provider without changing
  how they consume the result. EdenAI's `tts` subfeature is sync (`POST
  /v3/universal-ai`, confirmed via `GET /v3/info/audio/tts`) and returns
  a signed CloudFront `audio_resource_url` rather than inline bytes, so
  this makes a second, `safeFetch`-guarded request to download it before
  reusing `lib/tts.js`'s existing `mp3ToCanonicalPcm` for the same PCM
  normalization every other TTS path already goes through. Always sends
  an explicit `voice` (never the provider default) per the pitfall
  above.
- Three call sites — `pages/api/transcriptions/[id]/audio.js`,
  `pages/api/share/[token]/audio.js`, `lib/in-meeting-audio.js`'s
  `speakOne()` — resolve their provider via
  `resolveActiveProviderConfig({capability:'tts'})` instead of a
  hardcoded `resolveOpenRouterConfig`/`provider:'openrouter'`, branching
  `synthesizeSpeechEdenAi`/`openRouterTts` the same way every other
  capability migration in this sequence already branches its own pair.
- `pages/api/organizations/integrations/edenai/activate.js`'s TTS probe
  input now includes an explicit `voice: EDENAI_TTS_DEFAULT_VOICE` — for
  the same reason the real adapter always sends one; otherwise the probe
  would validate connectivity against a code path real usage never
  takes.
- `.env.example`'s `OUTBOUND_ALLOWED_HOSTS` gains
  `d14uq1pz7dzsdq.cloudfront.net` — EdenAI's own CDN host for returned
  TTS audio, confirmed stable across all 6 models/providers tested (not
  a documented API contract — see design.md's Risks).
- `components/settings/EdenAiIntegrationPanel.js`: the TTS voice field's
  placeholder/hint updated to reflect the real default (`"Kore"`), not
  the previous ElevenLabs-style example (`"Rachel"`) left over from
  before a model was chosen.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `edenai-provider`: `EDENAI_HARDCODED_MODEL.tts`'s "Hardcoded
  Per-Capability Model" requirement moves from undecided (`null`) to
  decided, with its own scenario describing the required explicit-voice
  behavior.

## Impact

- Changed: `lib/edenai.js`, `lib/edenai-service.js` (new export),
  `pages/api/transcriptions/[id]/audio.js`,
  `pages/api/share/[token]/audio.js`, `lib/in-meeting-audio.js`,
  `pages/api/organizations/integrations/edenai/activate.js`,
  `components/settings/EdenAiIntegrationPanel.js`, `.env.example`
- Changed: `lib/tts.js` (`mp3ToCanonicalPcm` exported for reuse, no
  behavior change)
- Unchanged: `lib/edenai-pricing.js`'s `tts` operation list (already
  correct from the foundation phase), `openRouterTts` itself, every
  downstream consumer of the rendered PCM (WAV header building, budget
  reservation, streaming)
