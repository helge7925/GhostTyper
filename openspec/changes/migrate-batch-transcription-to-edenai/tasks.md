# Tasks: Migrate Batch Transcription To EdenAI

## 1. EdenAI Transcription Adapter

- [x] 1.1 `lib/edenai-service.js`: `transcribeAudioEdenAi(filePath, apiKey,
  model, options)` — submit via `submitEdenAiAsyncJob`, poll via
  `pollEdenAiAsyncJob` with a bounded interval/timeout, return
  `{text, segments, usage, model, providerRequestId, contextBiasForwarded}`.
  Reuses `lib/ai-service.js`'s `prepareAudioForTranscription` (now
  exported) for chunking/compression and `lib/audio-utils.js`'s
  `stripOverlapPrefix` for stitching — no duplicated chunking logic.
  `lib/edenai.js` gained a new `uploadEdenAiFile` primitive (multipart
  `POST /v3/upload`) since EdenAI's async job needs a `file_id`, not
  inline file bytes.
- [x] 1.2 Distinct error for a poll timeout: `EdenAiError` with
  `code: 'EDENAI_REQUEST_FAILED'`, `status: 504`, separate from both
  `MODEL_UNAVAILABLE` and a genuine job-`failed` error (`status: 502`).
- [x] 1.3 EdenAI `OPERATIONS` map already had `transcription` →
  `['transcription']` from the Foundation phase — confirmed unchanged,
  no edit needed.

## 2. Worker Refactor

- [x] 2.1 `lib/transcription-worker.js`'s `processClaimedJob()`: resolves
  the STT provider via `resolveActiveProviderConfig({capability:
  'transcription'})` (`activeTranscription`), replacing the hardcoded
  local `transcriptionProvider` constant; the shared `executeChunk`
  closure branches `transcribeAudio`/`transcribeAudioEdenAi` on
  `activeTranscription.provider`.
- [x] 2.2 **Changed from the original plan** — the analysis/chat call
  site keeps its own hardcoded `resolveOpenRouterConfig` call,
  completely untouched; it is *not* routed through
  `resolveActiveProviderConfig({capability:'chat'})`. See design.md's
  "Design correction" section for why (chat now has a real hardcoded
  EdenAI model, so routing analysis through the same resolver would have
  been an uncontrolled scope expansion into `migrate-chat-tts-and-
  decommission-openrouter`'s territory, not "no behavior change" the way
  it was when this task was originally written).
- [x] 2.3 `verboseJsonSupported` catalogue probe gated behind
  `activeTranscription.provider !== 'edenai'`.

## 3. Pricing

- [x] 3.1 **Changed from the original plan** — done via code, not an
  admin runbook step. The `(edenai, audio/speech_to_text_async/gladia,
  transcription)` price row is now seeded automatically by
  `lib/pricing-seed.js`'s `INITIAL_PROVIDER_PRICES` on every
  `initDatabase()` call, using the exact $0.0102/min rate already
  documented above — no admin action needed before a workspace
  activates `transcription` for the first time. Verified end-to-end
  against a real, throwaway local Postgres instance (never the user's
  running containers). See `migrate-live-meeting-stt-to-edenai/status.md`
  for the cross-cutting writeup of this seeding mechanism.

## 4. Tests

- [x] 4.1 `tests/edenai-transcription.test.mjs`: 5 mocked-fetch contract
  tests for `transcribeAudioEdenAi` — inline-success, poll-until-success,
  job-failure (`EDENAI_REQUEST_FAILED`), `MODEL_UNAVAILABLE` with no
  model, and `executeChunk` wiring.
- [x] 4.2 `tests/pricing-core.test.mjs` and `tests/budget-runtime.test.mjs`
  updated: the transcription provider is now asserted as dynamically
  resolved (`provider: activeTranscription.provider`,
  `resolveActiveProviderConfig(...)`) rather than the old hardcoded
  `const transcriptionProvider = 'openrouter'` literal.
- [x] 4.3 The mid-file chunk-failure case from design.md's Risks section
  is covered at the leaf level (4.1's job-failure test confirms
  `transcribeChunkEdenAi` throws cleanly on a failed job) — a dedicated
  multi-chunk integration test was not added on top of that, since the
  outer chunk loop that would need to handle a failure mid-sequence is
  `lib/ai-service.js`'s existing, unmodified loop structure (also reused
  by `transcribeAudioEdenAi` unchanged) — already relied upon for
  OpenRouter's identical failure mode. Flagged in design.md's Risks as
  real but not independently re-verified here, not silently assumed
  fine.

## 5. Verification

- [x] 5.0 Live model-selection comparison (2026-08-30): 7 EdenAI STT
  vendors tested against locally-synthesized audio (never real user
  recordings), two rounds (initial + harder follow-up), reproducibility
  reruns, cost/region trade-off surfaced to and decided by the user. Full
  evidence in design.md. `gladia` selected.
- [x] 5.0.1 Live-called the actual shipped `transcribeAudioEdenAi`
  (imported directly from `lib/edenai-service.js`, not a reimplementation)
  against production EdenAI with a real synthesized audio file — correct
  transcription, correct return shape. Key deleted from scratchpad
  immediately after each of the three rounds it was needed for, verified
  no leak via repo-wide grep every time.
- [ ] 5.1 Manual: activate EdenAI for `transcription` on a test workspace
  (DB + `next dev` + browser, full seeded flow), upload an audio file
  spanning multiple chunks, confirm the finished transcript matches
  expectations and `usage_log` shows one `provider='edenai'` row per
  chunk. Not yet run — same class of remaining check as
  `migrate-translation-to-edenai`'s task 5.5.
- [ ] 5.2 Manual: same workspace with `chat` still on OpenRouter, enable
  auto-analyze, confirm the analysis step still runs and succeeds. Not
  yet run.
- [x] 5.3 `npm test` passes (450 tests / 438 pass / 12 skipped / 0
  failed, up from the pre-existing 445/433/12/0 baseline).
- [x] 5.4 `openspec validate migrate-batch-transcription-to-edenai
  --strict` passes.
