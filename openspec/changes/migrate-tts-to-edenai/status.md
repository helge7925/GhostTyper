# Status: Migrate Text-To-Speech To EdenAI

Last updated: 2026-08-30

## Current State

- **Implemented** (code + tests + docs). Pulled out of the originally-
  planned `migrate-chat-tts-and-decommission-openrouter` bundle into its
  own change — see that change's status.md for the note recording the
  split. Sixth and last of the six originally-planned EdenAI capability
  decisions (`chat`, `transcription`, `translation`→chat, `ocr`→chat,
  `liveTranscription`→permanently excluded in favor of direct Mistral,
  `tts` here) — this closes out the "which capability goes where"
  question for every workload this migration set out to decide. Two
  manual-verification tasks remain (7.3/7.4) and the pricing runbook row
  (5.2) — same "code done, real-workspace smoke-test still open" state
  every prior change in this sequence finished in.

## Model selection: google/gemini-2.5-flash-tts, voice "Kore" (2026-08-30)

Full evidence and both test rounds (default-voice pitfall, then
explicit-voice retest) are in design.md. Summary: `microsoft/neural`
disqualified on a real financial-figure corruption even with a
premium-tier voice; the three cheapest EU, round-trip-correct candidates
were sent to the user as real audio files, since round-trip correctness
via an ASR proxy cannot judge naturalness — only a human ear can. The
user picked `google/gemini-2.5-flash-tts` (voice "Kore"): a modern
LLM-based synthesis model, EU region, ~$0.0062/1000 chars (normalized
from its per-minute billing), only marginally pricier than the cheapest
tier tested ($0.004/1000 chars).

## Real pitfall found and fixed: default voice selection

Before any quality judgment could even be made, round 1 of testing
(omitting the `voice` field, as the app's earlier code paths might have
been tempted to do) showed EdenAI silently picks a bad default voice for
nearly every model — garbled or partly-wrong German output, confirmed by
round-tripping each sample back through the app's own verified `gladia`
transcription. This is now a hard rule baked into the code and the spec:
`synthesizeSpeechEdenAi` and the activation probe both always send an
explicit voice (`EDENAI_TTS_DEFAULT_VOICE` as the fallback), never rely
on the provider default. Anyone extending this adapter to a new EdenAI
TTS model later should re-verify voice selection explicitly, not assume
"no voice specified" is a safe no-op.

## Implementation (2026-08-30)

- `lib/edenai.js`: `EDENAI_HARDCODED_MODEL.tts` set, new
  `EDENAI_TTS_DEFAULT_VOICE = 'Kore'` export, full evidence in the module
  comment (mirrors the existing chat/transcription comment style).
- `lib/edenai-service.js`: new `synthesizeSpeechEdenAi` — sync
  `/universal-ai` call (confirmed via `GET /v3/info/audio/tts`,
  `"mode": "sync"`), downloads the returned `audio_resource_url` via
  `safeFetch` (SSRF guard, same reasoning `openRouterTts` already
  applies to its own upstream call), reuses `lib/tts.js`'s
  `mp3ToCanonicalPcm` (now exported) for PCM normalization. Same
  `Buffer`-with-`.providerRequestId`/`.usage` return contract as
  `openRouterTts`, except `providerRequestId` is always `null` (EdenAI's
  sync TTS response has no per-request id field).
- Three call sites (`pages/api/transcriptions/[id]/audio.js`,
  `pages/api/share/[token]/audio.js`, `lib/in-meeting-audio.js`'s
  `speakOne()`) now resolve via
  `resolveActiveProviderConfig({capability:'tts'})` and branch
  `synthesizeSpeechEdenAi`/`openRouterTts`, mirroring every other
  capability migration's branch pattern in this sequence. Two stale,
  unrelated comments fixed in passing (a "Mistral key" comment in the
  share-audio route, a "Voxtral TTS PCM" comment in in-meeting-audio.js
  — both leftover artifacts from earlier phases, neither accurate for
  this code).
- `pages/api/organizations/integrations/edenai/activate.js`: TTS probe
  input now sends `voice: EDENAI_TTS_DEFAULT_VOICE` explicitly, for the
  same "never omit voice" reason.
- `.env.example`: `d14uq1pz7dzsdq.cloudfront.net` added to
  `OUTBOUND_ALLOWED_HOSTS` — EdenAI's CDN host for TTS audio, confirmed
  identical across all 12 test calls (6 models × 2 rounds) in this
  round of testing, though this is an empirical observation, not a
  documented EdenAI API contract — see design.md's Risks section for the
  fail-closed behavior if that ever changes.
- `components/settings/EdenAiIntegrationPanel.js`: TTS voice field's
  placeholder updated from the leftover "Rachel" (an ElevenLabs-style
  example, dating from before this decision) to "Kore" (the real
  default), with an inline hint that a blank field uses that default.
- Tests: `tests/edenai-tts.test.mjs` (6 tests, network-independent —
  `safeFetch`'s DNS check is satisfied via a loopback IP rather than a
  real hostname, avoiding any live-network dependency in the suite).
  `tests/edenai.test.mjs`'s `EDENAI_HARDCODED_MODEL` shape test updated
  (previously asserted `tts` was still undecided). `npm test` → 474
  tests / 462 pass / 12 skipped / 0 failed (up from 468/456/12/0). Lint
  clean.
- `openspec validate migrate-tts-to-edenai --strict` passes.

## Pricing seeded automatically, PCM conversion tested (2026-08-31)

Both items below were flagged as open in this section and are now
closed:

- The four TTS price rows now live in `lib/pricing-seed.js`'s
  `INITIAL_PROVIDER_PRICES`, seeded automatically on every
  `initDatabase()` call — no admin action needed before a workspace
  activates TTS. Per the user's own observation: pricing shouldn't need
  a workspace to exist first, and `provider_price_versions` already has
  no `organization_id` column (it's a platform-wide catalogue), so this
  was always structurally possible — it just hadn't been done yet.
  Verified end-to-end against a real, throwaway local Postgres (never
  the user's running containers): `initDatabase()` ran clean,
  `resolveProviderPrice` resolved a seeded TTS row with no
  `organizationId`. The rate is a real conversion of the $0.006/min
  figure using this change's own measured chars/min throughput — an
  estimate for reservation purposes, not a vendor-quoted per-character
  price (see `lib/pricing-seed.js`'s comment for the full derivation).
- `mp3ToCanonicalPcm` now has real test coverage
  (`tests/tts-pcm-conversion.test.mjs`) — synthesizes actual MP3s via
  the already-installed `@ffmpeg-installer/ffmpeg` dependency (unlike
  poppler in the OCR tests, no graceful skip needed, since this binary
  ships with `npm ci`). Along the way, found and documented a real,
  previously-unverified behavior: forced-format ffmpeg decoding of
  non-MP3 input resolves with an empty buffer instead of throwing —
  matches how every TTS call site already treats a zero-length PCM
  buffer (skip the write), so not a new failure mode, just now a tested
  one instead of an assumed one.

## Outstanding

- Tasks 7.3/7.4: full real-workspace verification (in-meeting audio
  injection, live read-aloud, share-link read-aloud, `usage_log` rows
  with `provider='edenai'`) — not yet run. Same open-item pattern as
  every other change in this migration sequence's final manual-
  verification tasks.
- `speed`/`speaking_pitch`/`speaking_volume` (present in EdenAI's `tts`
  input schema) are not wired up — matches `openRouterTts`'s existing
  feature set exactly, a deliberate non-goal of this change, not an
  oversight.
