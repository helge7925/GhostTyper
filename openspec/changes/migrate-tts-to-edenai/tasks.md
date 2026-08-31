# Tasks: Migrate Text-To-Speech To EdenAI

## 1. Model Selection

- [x] 1.1 Live-tested all 6 EU-region EdenAI TTS models against the same
  German text, first with default voices (revealed a real pitfall: bad
  defaults for nearly every model), then with explicit known-good German
  voices (all but `microsoft/neural` became round-trip-correct via a
  gladia-transcription proxy check).
- [x] 1.2 Sent the three cheapest, round-trip-correct, EU-region
  candidates to the user as real audio samples — round-trip correctness
  cannot judge naturalness, only a human listener can. User chose
  `google/gemini-2.5-flash-tts`, voice `"Kore"`.
- [x] 1.3 `lib/edenai.js`: `EDENAI_HARDCODED_MODEL.tts` set,
  `EDENAI_TTS_DEFAULT_VOICE` added, full evidence documented in the
  module comment.

## 2. EdenAI TTS Adapter

- [x] 2.1 `lib/edenai-service.js`: `synthesizeSpeechEdenAi` — sync
  `/universal-ai` call, `voice` always sent explicitly, downloads
  `audio_resource_url` via `safeFetch`, reuses `lib/tts.js`'s
  `mp3ToCanonicalPcm` (exported for this purpose) for PCM normalization.
  Same `Buffer`-with-`providerRequestId`/`usage` contract as
  `openRouterTts`.
- [x] 2.2 `lib/tts.js`: exported `mp3ToCanonicalPcm` (was private) —
  behavior unchanged, just reusable now.
- [x] 2.3 `.env.example`: added `d14uq1pz7dzsdq.cloudfront.net` (EdenAI's
  TTS audio CDN host, confirmed stable across every model tested) to
  `OUTBOUND_ALLOWED_HOSTS`.

## 3. Pre-Cutover Probe

- [x] 3.1 `pages/api/organizations/integrations/edenai/activate.js`:
  `STATIC_PROBE_INPUT.tts` gained an explicit `voice:
  EDENAI_TTS_DEFAULT_VOICE` — otherwise the probe would validate a code
  path (no voice) real usage never takes.

## 4. Call Sites

- [x] 4.1 `pages/api/transcriptions/[id]/audio.js`: replaced
  `resolveOpenRouterConfig`/hardcoded `provider:'openrouter'` with
  `resolveActiveProviderConfig({capability:'tts'})`, branching
  `synthesizeSpeechEdenAi`/`openRouterTts`.
- [x] 4.2 `pages/api/share/[token]/audio.js`: same swap. Also fixed a
  stale comment ("Use the row owner's Mistral key") that had nothing to
  do with this file's actual TTS provider resolution.
- [x] 4.3 `lib/in-meeting-audio.js`'s `speakOne()`: same swap. Also fixed
  a stale "Render Voxtral TTS PCM" comment (leftover from the live-STT
  bridge's naming, not this function).
- [x] 4.4 `components/settings/EdenAiIntegrationPanel.js`: TTS voice
  field's placeholder/hint updated from the leftover ElevenLabs-style
  example ("Rachel") to the real chosen default ("Kore").

## 5. Pricing

- [x] 5.1 `lib/edenai-pricing.js`'s `tts` operation list (`['tts',
  'live_tts', 'live_tts_share', 'in_meeting_tts']`) was already correct
  from the foundation phase — no change needed.
- [x] 5.2 **Changed from the original plan** — done via code, not an
  admin runbook step. All four `(edenai, audio/tts/google/gemini-2.5-
  flash-tts, <operation>)` price rows are now seeded automatically by
  `lib/pricing-seed.js`'s `INITIAL_PROVIDER_PRICES` on every
  `initDatabase()` call — no admin action needed before a workspace
  activates TTS for the first time. The per-character rate is a real
  conversion of the $0.006/min figure (using this change's own measured
  ~974 chars/min throughput), not a vendor-quoted per-character price —
  see that file's TTS section for the full derivation and its
  documented limitation. Verified end-to-end against a real, throwaway
  local Postgres instance (never the user's running containers).
  `tests/pricing-seed.test.mjs` covers the seed data structurally.

## 6. Tests

- [x] 6.1 `tests/edenai-tts.test.mjs`: `synthesizeSpeechEdenAi` — empty
  text, missing model, default-voice fallback, explicit-voice override,
  sync-mode logical failure, audio-download failure. **Update
  (2026-08-31)**: the `mp3ToCanonicalPcm` round trip this task originally
  left untested now has real coverage —
  `tests/tts-pcm-conversion.test.mjs` synthesizes real MP3s via
  `@ffmpeg-installer/ffmpeg` (already an app dependency, no graceful-skip
  needed) and verifies output size/scaling, plus a real, previously
  undocumented behavior found along the way: non-MP3 input resolves with
  an empty buffer rather than throwing (ffmpeg's forced `inputFormat`
  is lenient) — matches how call sites already treat a zero-length PCM
  buffer as "nothing to send." `safeFetch`'s DNS-based host check is
  exercised safely using a loopback IP (127.0.0.1), avoiding any real
  network dependency in the test.
- [x] 6.2 `tests/edenai.test.mjs`: updated the existing
  `EDENAI_HARDCODED_MODEL` shape test, which asserted `tts` was still
  `null` — now asserts the real chosen model and voice fallback.

## 7. Verification

- [x] 7.1 `npm test` passes (474 tests / 462 pass / 12 skipped / 0
  failed, up from 468/456/12/0). `npx eslint .` clean.
- [x] 7.2 `openspec validate migrate-tts-to-edenai --strict` passes.
- [ ] 7.3 Manual: activate EdenAI for `tts` on a test workspace (probe
  passed, pricing satisfied), confirm in-meeting audio injection, live
  read-aloud, and share-link read-aloud all still produce correctly
  normalized, audible PCM. Not yet run — same open-item pattern as every
  other change in this migration sequence.
- [ ] 7.4 Manual: confirm `usage_log` records `provider='edenai'` rows
  for `live_tts`/`live_tts_share`/`in_meeting_tts` through a real
  workspace with TTS activated. Not yet run.
