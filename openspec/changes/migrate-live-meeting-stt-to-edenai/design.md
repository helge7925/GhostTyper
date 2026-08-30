# Design: Migrate Live Meeting Transcription To EdenAI

**This change's actual outcome is not an EdenAI migration** — see
proposal.md's opening note and the evidence below. Kept under this
folder name for sequence continuity.

## The Architecture Mismatch, Precisely

`services/voxtral-bridge/main.py`'s `proxy()` is a single synchronous
request/response cycle: Vexa-Lite POSTs a multipart audio chunk roughly
every 2-3 seconds and blocks on the bridge's HTTP response. EdenAI's STT
product is confirmed async/job-based (`POST /v3/universal-ai/async` →
poll `GET /v3/universal-ai/async/{job_id}`) with no low-latency streaming
alternative. This section of the plan was correct going in — the
question was always going to be either "can async-with-polling fit
inside the chunk cadence" or "does this need a different provider
entirely." Live measurement answered it.

## Go/No-Go Measurement (2026-08-30)

Test setup: a ~2.2s German speech clip synthesized locally (macOS `say`,
never real user audio — same practice as every other model comparison in
this migration), fed to each candidate exactly as the real bridge would
receive it (already fully recorded, not throttled to live-mic playback
speed — this distinction mattered a lot, see below).

**EdenAI** (3 vendors, `audio/speech_to_text_async`, upload → submit →
poll):

| Vendor | Round-trip |
|---|---|
| gladia (already the batch-transcription choice) | 4.8-8.6s, 3-9 poll cycles |
| openai (fastest of the 3, inline-success, no polling needed) | 3.5-4.5s |
| deepgram/nova-3 | 3.98-4.3s |

Even the fastest EdenAI vendor's round-trip (3.5-4.5s) exceeds the
~2-3s chunk-arrival cadence — the bridge would fall progressively behind
real-time over a meeting's duration, regardless of vendor choice. This
is a structural property of the async-job model (upload + job-submission
round trip alone accounts for most of the latency, before any actual
transcription or polling), not a slow-vendor problem.

**OpenRouter** (current path): the user independently tested this and
confirmed it is not meaningfully faster — no formal measurement recorded
here, taken as given.

**Mistral direct realtime** (`voxtral-mini-transcribe-realtime-2602`,
`mistralai[realtime]` Python SDK, WebSocket `/v1/audio/transcriptions/
realtime`):

| Test | Round-trip | Note |
|---|---|---|
| ~2.2s clip, audio fed at real-time playback speed (throttled) | 2.9-3.4s | First delta at 0.9-1.3s — includes ~2.2s of simulated live-mic feed time |
| ~2.2s clip, audio fed as fast as possible | **0.76-0.90s** | First delta at 0.40-0.53s |
| ~6.3s clip (harder text: numbers, "12.500 Euro"), fed fast | **1.4-1.5s** | Correct output, tail latency stays low regardless of chunk length |
| English, ~5.1s clip, fed fast | **1.2-1.4s** | Correct ("$12,500") |

The "fed fast" numbers are the representative ones: Vexa POSTs a chunk
that is **already fully recorded** by the time the bridge receives it —
there is no live microphone to throttle against inside the bridge, so
feeding the whole chunk to Mistral immediately (not paced to real-time
playback) is both correct and what produced the fast numbers. This
result is decisively inside the chunk-cadence budget, with no polling
required at all (the SDK's `transcribe_stream` yields a
`transcription.done` event carrying the full final text directly).

**Verdict**: Mistral direct — GO. EdenAI and OpenRouter — No-Go for this
specific capability. This is a genuine, deliberate exception: unlike
every other capability in this migration ("prefer EdenAI once activated,
else OpenRouter"), live-meeting STT has no acceptable fallback provider
and routes to Mistral exclusively, per the user's explicit direction.

## End-to-End Pipeline Validation

Two gaps the raw API latency numbers above don't cover, both closed
before implementing:

1. **Audio format**: Vexa sends compressed audio (webm/opus container,
   confirmed by the pre-existing bridge code's `extension` handling,
   defaulting to `webm`/normalizing `weba`→`webm`). Mistral's realtime
   endpoint only accepts raw PCM S16LE. Measured the required `ffmpeg`
   transcode (webm/opus → PCM S16LE) locally: **~11ms** for a ~2.2s
   clip — negligible against the ~0.8-1.5s realtime-API latency.
2. **The actual shipped code, not a hand-rolled test script**: ran the
   real `services/voxtral-bridge/main.py` as a live `uvicorn` server, in
   an isolated environment, and POSTed a real webm/opus multipart
   request (matching Vexa's exact request shape: `file` field +
   `platform`/`native_meeting_id` fields + `X-Romaco-Org` header)
   against production Mistral. Result: **1.1-1.4s** total, correct
   transcript, 3 reruns byte-identical. Also verified the `no_api_key` →
   `503` error path with the real server. Key deleted from scratchpad
   immediately after, no leak (repo-wide grep clean).

## Chosen Architecture: One Realtime Session Per HTTP Chunk

Mistral's realtime protocol is designed around a **persistent, continuous
session** — connect once, stream audio in as it's captured, read
incremental deltas back. A "correct" integration in the fullest sense
would hold one WebSocket connection open per active meeting for its
whole duration, forwarding each Vexa chunk's raw audio into that same
stream and correlating results back to individual HTTP responses. This
was considered and deliberately not built yet:

- It requires session lifecycle management this codebase doesn't have
  today for STT: when does a session open (first chunk? an explicit
  meeting-start signal Vexa may or may not send?), how does it survive a
  dropped connection mid-meeting, how is per-meeting state tracked across
  the bridge's request handlers.
- The simpler approach — open a fresh realtime session per incoming HTTP
  chunk, feed that chunk's audio, read the `transcription.done` event,
  close — already measures well inside the latency budget (0.76-1.5s
  vs. a ~2-3s cadence), with real headroom, not a photo finish.
- This keeps the bridge's request-handler shape essentially what it
  already was (stateless, one request in → one response out), which is a
  meaningfully smaller and more reviewable change than introducing
  persistent per-meeting connection state.

Recorded as a real, not-yet-taken optimization: if per-chunk connection
overhead becomes a genuine problem at higher concurrent-meeting scale (not
observed here — single-request testing only), a persistent-session
redesign is the documented next step, not a redesign done blind now.

## `services/voxtral-bridge/main.py` — What Changed

- `fetch_effective_config()`: same shape (per-scope TTL cache, webapp
  callback with a 60s refresh window), but the cached/returned fields
  are now `api_key`/`model`/`context_bias`/`source` — no more
  `base_url`/`verbose_json`, which were OpenRouter REST-endpoint
  concepts with no realtime-WebSocket equivalent.
- New `_transcode_to_pcm()`: shells out to `ffmpeg` (via
  `subprocess.run`, called through `asyncio.to_thread` so the blocking
  call doesn't stall the event loop) to convert the incoming chunk to
  PCM S16LE at 16kHz mono.
- New `_transcribe_via_mistral()`: `Mistral(api_key=...).audio.realtime.
  transcribe_stream(...)`, feeding PCM in fixed-size pieces via an async
  generator (no artificial pacing — see the "fed fast" finding above),
  returning the `transcription.done` event's `.text` field directly (no
  manual delta-concatenation needed — the SDK's own final event already
  carries the complete transcript).
- Context-bias (vocabulary hint) forwarding is **not** ported — Mistral's
  realtime protocol has no documented prompt/vocabulary parameter
  (unlike OpenRouter's Groq-specific best-effort passthrough this
  replaces). Logged when configured but unused, not silently dropped.
- Response shape: plain Whisper-style `{"text": "..."}`, matching what
  Vexa-Lite already expected from the old OpenRouter path. No
  `verbose_json`/segments support for this path (Mistral's realtime
  `TranscriptionStreamDone` event does carry a `segments` field, per its
  SDK model, but wiring that through was not needed to match today's
  contract and is deferred rather than spun up speculatively).

`services/voxtral-bridge/Dockerfile` gains `ffmpeg` (apk, matching the
main app's Docker image already having it for the same reason) and
`mistralai[realtime]==2.9.4` (pip, which also pulls in `websockets`).

## `lib/mistral.js` — Deliberately Generic, Not STT-Only

The user asked that this new direct-Mistral integration be usable for
live-meeting *translation* later too, not just STT. `normalizeMistralConfig`
carries only what's provider-generic (an API key) — no capability-specific
fields, unlike EdenAI's `activatedCapabilities`/per-capability hardcoded-
model map, which exists because EdenAI genuinely has many capabilities
with independent activation. Mistral direct has exactly one consumer so
far (`MISTRAL_LIVE_TRANSCRIPTION_MODEL`, live-meeting STT); a second
consumer (e.g. a future direct-Mistral chat-completions path for
`runTranslationDelta`) would add its own hardcoded-model constant next to
it and reuse the same `resolveMistralConfig`/credential storage, no
schema change needed.

`runTranslationDelta` itself is **not** switched to direct Mistral in
this change — it already works via EdenAI's `chat` capability
(`mistral/mistral-small-latest`, aggregated through EdenAI, not called
directly), which has no latency problem (translation is polled
independently at 500ms, not blocking a live-meeting audio chunk the way
STT does) and was already built and tested in
`migrate-translation-to-edenai`. Only its provider-resolution call site
was deferred to land here (see `tasks.md`); the underlying adapter is
unchanged.

## `checkpointMeetingStt` — Budget Checkpoint, Not A Provider Call

This function never calls the STT provider itself — the actual
transcription happens in the separate Python bridge process. It only
reserves/commits budget on a periodic (30-second-block) basis, based on
observed elapsed audio seconds reported elsewhere. Before this change it
independently hardcoded `provider:'openrouter'` three times, meaning a
meeting's billing checkpoint would throw `MODEL_UNAVAILABLE` if
OpenRouter wasn't configured — regardless of what the bridge was actually
using. Now it resolves `resolveMistralConfig` and bills
`provider:'mistral'` unconditionally (no fallback branching, matching
the bridge's own exclusivity) — the two sides (bridge and billing
checkpoint) aren't directly coupled at the request level, they just both
need to agree on the same provider, which they now structurally do by
both hardcoding Mistral rather than one defaulting to OpenRouter.

## What Is Not Touched

`lib/vexa-webhook-signature.js` (HMAC verification of the Vexa-Lite→
webapp webhook channel) and `pages/api/webhooks/vexa.js`/
`lib/vexa-reconcile-worker.js` (event handling and the 60s reconciliation
backstop for missed webhooks) authenticate and finalize meetings
independent of which STT vendor sits behind the bridge — none of this
migration touches them.

## Risks / Trade-offs

- **Per-chunk WebSocket handshake overhead at scale**: measured against a
  single request at a time; concurrent-meeting behavior (many
  simultaneous per-chunk WS connections) was not load-tested. If this
  turns out to matter, the persistent-session architecture above is the
  documented next step — not assumed fine.
- **No context-bias/vocabulary forwarding**: a real, acknowledged feature
  regression from the OpenRouter path's best-effort Groq passthrough
  (which was itself already only best-effort and provider-dependent) —
  Mistral's realtime protocol has no documented equivalent parameter.
- **No diarization/segments in the response**: `TranscriptionStreamDone`
  does carry a `segments` field per the SDK's model, not wired through —
  deferred, not a capability gap in the underlying API.
- **poppler... no — ffmpeg as a new bridge-container dependency**: a real
  infrastructure change (Docker image rebuild required) — the main
  webapp's own image already has ffmpeg for unrelated reasons, but the
  bridge container is a separate, previously much smaller image, so this
  is a real size/attack-surface increase worth naming, not free.
- **Two different "Mistral" integration paths now exist** in this
  codebase for two different reasons: (1) EdenAI's aggregated `chat`
  capability, which happens to route to Mistral's `mistral-small-latest`
  model as EdenAI's backend — this is what `spelling_grammar`,
  translation, OCR, and (unchanged) `runTranslationDelta` all use; (2)
  this change's new direct-Mistral integration
  (`lib/mistral.js`/`resolveMistralConfig`), used only for live-meeting
  STT. They are unrelated code paths with separate credentials, and
  conflating them would be a real source of confusion — flagged
  explicitly here and in the relevant code comments.
