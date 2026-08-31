# Change: Migrate Batch Transcription To EdenAI

## Why

Upload-based transcription today runs through OpenRouter's
`/audio/transcriptions` endpoint against Whisper-family/foundation
models. EdenAI exposes purpose-built enterprise STT vendors (Amazon
Transcribe, Deepgram, AssemblyAI, Speechmatics, and others) with native
diarization and native custom-vocabulary support — real quality levers
this codebase currently only approximates with manual speaker assignment
and a Groq-only best-effort context-bias hack. This change migrates the
provider only; adopting the native quality features is intentionally
deferred to keep this a small, verifiable step (see design.md).

## What Changes

- `lib/edenai-service.js` gains `transcribeAudioEdenAi`, wrapping EdenAI's
  async speech-to-text job (submit → poll) behind the same per-chunk
  synchronous contract `lib/ai-service.js`'s `transcribeAudio` already
  exposes to its callers.
- `lib/transcription-worker.js`'s `processClaimedJob()` resolves the
  transcription provider and the analysis provider **independently** —
  after this change, a workspace can have `transcription` on EdenAI while
  `chat` (analysis) stays on OpenRouter, in the same job.
- No change to chunking, overlap-stitching, or budget-reservation logic in
  `lib/ai-service.js`'s `transcribeAudio`/`prepareAudioForTranscription` —
  only the leaf per-chunk request function is new.
- Manual speaker assignment and best-effort context-bias forwarding are
  unchanged. Native diarization/vocabulary adoption is explicitly out of
  scope.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `edenai-provider`: adds the EdenAI Batch Transcription Adapter
  requirement.

## Impact

- Changed: `lib/transcription-worker.js` (two independent provider
  resolutions instead of one)
- Changed: `lib/edenai-service.js` (new export)
- Unchanged: `lib/ai-service.js`'s chunking/stitching, budget-reservation
  logic in `lib/budget-runtime.js`
