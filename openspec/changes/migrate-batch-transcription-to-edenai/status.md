# Status: Migrate Batch Transcription To EdenAI

Last updated: 2026-08-30

## Current State

- **Implemented**, two manual-verification tasks remaining (5.1/5.2) and
  the pricing runbook step (3.1) — same "code done, real-workspace
  smoke-test still open" state `migrate-translation-to-edenai` finished
  in. Third capability decided under the `hardcode-edenai-models`
  architecture (`chat` first, `translation`-routed-through-`chat`
  second, `transcription` now third — its own real EdenAI capability,
  unlike the previous two).

## Model selection: gladia (2026-08-30)

Live-tested 7 of EdenAI's 9 `audio/speech_to_text_async` vendors against
locally-synthesized German/English business audio (macOS `say`, never
real user recordings — real `.m4a` files found in `uploads/`/
`docker-data/uploads/` during this work were deliberately not touched).
`assembly` disqualified (dropped numeric amounts from German output
entirely); `google` disqualified (no punctuation/capitalization in
either language). Of the rest, `gladia` and `openai` tied on quality and
beat `microsoft`/`amazon` (both had real defects); `deepgram/nova-3`
matched that top quality tier too, at roughly half `gladia`'s price, with
demonstrably working diarization (openai's Whisper-based engine has
none, structurally, regardless of price).

This cost-vs-region trade-off (cheapest: `deepgram/nova-3`, US; same-
quality-tier: `gladia`, EU) was put to the user explicitly rather than
decided unilaterally. The user's answer: keep `gladia`, and — generalized
into a standing rule for every future `EDENAI_HARDCODED_MODEL`
decision — minimize cost subject to a fixed quality bar *and* EU region,
not cost alone. Saved as a feedback memory
(`feedback_edenai_model_selection_criteria`) so this applies
automatically to the remaining `ocr`/`liveTranscription`/`tts` decisions
too.

A follow-up round re-verified `gladia` specifically after the user asked
for it (some defects had shown up in the first round): a fresh, harder
business text came back byte-identical and fully correct across 3 runs.
The earlier defects (a punctuation quirk, a mishearing) turned out to be
content-specific/shared-across-providers, not systemic to gladia. A
separate two-speaker diarization test's garbled output was traced to bad
macOS TTS voices ("Reed"/"Eddy"), not any STT provider — confirmed by
feeding the exact same sentence through a working voice ("Anna") vs a
broken one and reproducing the failure on the broken voice alone,
independent of gladia/openai/deepgram. Full evidence tables and the
testing-methodology lesson are in design.md.

## Implementation (2026-08-30)

- `lib/edenai.js`: `EDENAI_HARDCODED_MODEL.transcription` set to
  `'audio/speech_to_text_async/gladia'`; new `uploadEdenAiFile` primitive
  (multipart `POST /v3/upload`, returns `file_id`) since batch STT needs
  a persisted file reference, unlike chat/translation's inline text.
- `lib/edenai-service.js`: new `transcribeAudioEdenAi` — wraps EdenAI's
  upload → submit → poll job cycle behind the exact same per-chunk
  synchronous contract `lib/ai-service.js`'s `transcribeAudio` already
  exposes to `transcription-worker.js` (same options shape, same return
  shape). Reuses `prepareAudioForTranscription` (now exported from
  `lib/ai-service.js`) and `stripOverlapPrefix`
  (`lib/audio-utils.js`) rather than duplicating chunking/stitching
  logic — only the leaf per-chunk request (`transcribeChunkEdenAi`) is
  new. Bounded poll interval/timeout
  (`EDENAI_STT_POLL_INTERVAL_MS`/`EDENAI_STT_POLL_TIMEOUT_MS`, env-
  overridable, default 3s/10min), distinct timeout error from job-failure
  and from `MODEL_UNAVAILABLE`. No per-segment timestamps in EdenAI's
  schema — each chunk contributes one untimestamped pseudo-segment,
  mirroring `requestTranscriptionFile`'s own non-verbose fallback.
- `lib/transcription-worker.js`: `processClaimedJob()` now resolves the
  transcription provider via `resolveActiveProviderConfig({capability:
  'transcription'})`, independent of the (unchanged, still hardcoded to
  OpenRouter) analysis/chat resolution — a workspace can now have
  `transcription` on EdenAI while analysis stays on OpenRouter in the
  same job, exactly as the original proposal intended. **Deviated from
  this change's own pre-existing design.md** on one point: analysis was
  *not* additionally routed through `resolveActiveProviderConfig({capability:
  'chat'})` "for consistency" as originally planned — doing so would now
  actually change behavior (chat has a real hardcoded EdenAI model since
  `hardcode-edenai-models`), which is out of this change's scope per the
  master plan's standing exception list. Documented as a design
  correction in design.md, not a silent deviation.
- **Root-cause fix, not scoped to this change but necessary to ship
  it**: `lib/edenai-service.js` importing `lib/ai-service.js` was the
  first time anything in the Node-test-covered import graph reached
  `lib/ai-service.js` directly — which surfaced that `lib/ai-service.js`
  and 30 other `lib/` files use extensionless relative imports
  (`from './db'` instead of `from './db.js'`). Next.js/webpack resolves
  both forms identically (zero runtime behavior change, confirmed by a
  clean `npm run lint` and full `npm test` pass after), but Node's own
  ESM loader requires the explicit extension — it was failing with
  `ERR_MODULE_NOT_FOUND`. Fixed mechanically across all 31 affected files
  (a script that only appends `.js` when the target file demonstrably
  exists on disk, so directory-style imports were correctly left alone).
  `tests/edenai-optimize-text.test.mjs`/`tests/edenai-translation.test.mjs`
  also picked up the existing `DATABASE_URL`-guard-then-dynamic-import
  pattern (already used by `tests/edenai-pricing-gate.test.mjs` etc.),
  since the same new import chain transitively reaches `lib/db.js` via
  `api-utils.js` → `rate-limit.js`.
- Tests: new `tests/edenai-transcription.test.mjs` (5 tests: inline
  success, poll-until-success, job failure, `MODEL_UNAVAILABLE`,
  `executeChunk` wiring). `tests/edenai.test.mjs` updated for the decided
  model. `tests/pricing-core.test.mjs`/`tests/budget-runtime.test.mjs`
  updated: assert the transcription provider is dynamically resolved,
  not the old hardcoded `'openrouter'` literal. `npm test` → 450 tests /
  438 pass / 12 skipped / 0 failed (up from 445/433/12/0). Lint clean.
- Verification: live-called the actual shipped `transcribeAudioEdenAi`
  (not a reimplementation) against production EdenAI with a real
  synthesized audio file — correct transcription, correct
  `{text, segments, usage, model, providerRequestId,
  contextBiasForwarded}` shape. Key deleted from scratchpad after every
  use this round (three separate uses: initial model comparison,
  gladia re-verification, final shipped-code smoke test), no leak
  (repo-wide grep clean each time).
- `openspec validate migrate-batch-transcription-to-edenai --strict`
  passes.

## Outstanding

- Task 3.1: create the `(edenai, audio/speech_to_text_async/gladia,
  transcription)` price row — not yet needed since no workspace has
  activated this capability yet, but blocks activation via
  `findMissingEdenAiPrices` until it exists.
- Tasks 5.1/5.2: full DB + `next dev` + browser manual verification
  (activate `transcription`, upload a real multi-chunk audio file,
  confirm `usage_log` and the analysis-stays-on-OpenRouter behavior
  through the real UI) — not yet run, same open-item pattern as
  `migrate-translation-to-edenai`'s task 5.5.
- Native diarization/vocabulary adoption remains explicitly out of
  scope (see design.md) — this change is a pure provider swap.
- The mid-file chunk-failure case (one chunk's EdenAI call fails after
  prior chunks succeeded) is covered at the leaf-function level only,
  not with a dedicated multi-chunk integration test — see tasks.md's
  4.3 for the reasoning. Flagged as a real, not fully re-verified risk
  in design.md, not silently assumed fine.
