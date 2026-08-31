# Change: Migrate Live Meeting Transcription To EdenAI

**Outcome differs from the title** — kept for continuity with the
change-order sequence (this is still "the live-meeting-STT phase"), but
the actual result is not an EdenAI migration. See "Why" below: EdenAI was
tested and rejected on latency; live-meeting STT now calls Mistral
directly, bypassing both EdenAI and OpenRouter. This is the same
transparency practice used throughout this migration sequence (compare
`migrate-translation-to-edenai`, whose dedicated-adapter premise was
similarly overturned by live testing) — the proposal is rewritten in
place to reflect what was actually built and verified, not what was
originally planned.

## Why

Live-meeting transcription is the highest-latency-sensitive feature in
this app: Vexa-Lite chunks meeting audio aggressively (roughly every 2-3
seconds) and `services/voxtral-bridge/main.py`'s `proxy()` handler is a
single synchronous request/response cycle Vexa-Lite blocks on. EdenAI's
speech-to-text product is asynchronous/job-based; this change was
sequenced last among the transcription/OCR/translation migrations
specifically to measure that mismatch with a real Go/No-Go latency gate
before committing to an approach.

**Measured (2026-08-30), a ~2.2s synthetic audio chunk, repeated runs:**

| Path | Round-trip | Verdict |
|---|---|---|
| EdenAI (`gladia`, our chosen batch-transcription model) | 4.8-8.6s | No-Go — job submission alone took 2.7-3.2s before any polling |
| EdenAI (`openai`, fastest of 3 vendors tested) | 3.5-4.5s | No-Go — still exceeds the ~2-3s chunk cadence |
| OpenRouter (current path) | not meaningfully faster, per the user's own testing | No-Go |
| **Mistral direct** (`voxtral-mini-transcribe-realtime-2602`, WebSocket realtime API) | **0.76-1.5s**, audio fed as fast as it arrives (not throttled — Vexa already has each chunk fully recorded before POSTing) | **Go** |

Full methodology and evidence in design.md. Given neither existing
provider aggregation layer (OpenRouter's gateway, EdenAI's async job
model) could meet the latency bar, and a genuinely low-latency
alternative existed at the vendor level (Mistral's own realtime
streaming product, distinct from its batch/async transcription model),
the user directed an exclusive switch to Mistral direct for this one
capability — not a "prefer EdenAI, fall back to OpenRouter" gate like
every other capability in this migration, since there is no acceptable
fallback provider for live STT specifically.

## What Changes

- **New, direct Mistral integration** (`lib/mistral.js`,
  `lib/settings-service.js`'s `resolveMistralConfig`,
  `pages/api/organizations/integrations/mistral(.js|/test.js)`,
  `components/settings/MistralIntegrationPanel.js`) — a third provider
  category alongside OpenRouter and EdenAI, with its own credential
  (`organization_integrations` provider `'mistral'`, `MISTRAL_API_KEY`
  operator fallback). Deliberately generic, not STT-specific: the user
  asked this be reusable for live-meeting *translation* too, once that's
  decided — see "Deferred" below.
- `services/voxtral-bridge/main.py`: rewritten. Decodes Vexa's compressed
  audio chunk (webm/opus) to raw PCM via `ffmpeg`, opens one Mistral
  realtime WebSocket session per incoming HTTP chunk (not a persistent
  per-meeting session — see design.md for why the simpler per-chunk
  approach was chosen over a continuous-session architecture), streams
  the PCM in, and returns a Whisper-style `{"text": "..."}` response once
  `transcription.done` arrives. `services/voxtral-bridge/Dockerfile`
  gains `ffmpeg` (apk) and `mistralai[realtime]` (pip).
- `lib/integrations.js`'s `resolveBridgeTranscriptionConfig()`: resolves
  Mistral exclusively (org key → `BRIDGE_TRANSCRIPTION_API_KEY`/
  `MISTRAL_API_KEY` operator fallback) — no provider branching, no
  OpenRouter/EdenAI fallback for this capability.
- `pages/api/internal/whisper-config.js`: response shape simplified to
  match (`apiKey`, `model`, `contextBias`, `source` — no more
  `baseUrl`/`verboseJson`, which were OpenRouter REST-specific concepts
  with no equivalent for a WebSocket realtime protocol).
- `lib/budget-runtime.js`'s `checkpointMeetingStt()`: resolves Mistral
  config and bills `provider:'mistral'` — previously hardcoded
  `'openrouter'` three times, meaning a meeting failed outright if
  OpenRouter wasn't configured regardless of which provider was actually
  transcribing (now moot, since only Mistral configuration gates it).
- `lib/vexa-bridge.js`'s `runTranslationDelta()` (deferred from the
  Translation change): now routes through
  `resolveActiveProviderConfig({capability:'chat'})`, branching
  `translateTextSegments`/`translateTextSegmentsEdenAi` — this is
  EdenAI-capable (reuses the already-decided `chat` capability,
  `mistral/mistral-small-latest` via EdenAI's aggregation), unrelated to
  the new direct-Mistral STT integration. Two genuinely different
  "Mistral" paths now exist in this codebase for two different reasons —
  flagged explicitly in design.md to avoid confusion.
- `.env.example`, `config/docker-compose.{prod,dev}.yml`: updated for the
  new `MISTRAL_API_KEY`/removed dead `OPENROUTER_LIVE_TRANSCRIPTION_MODEL`.
  `OUTBOUND_ALLOWED_HOSTS` gains `api.mistral.ai`.

## Deferred (explicitly, not forgotten)

- Live-meeting *translation* via direct Mistral chat completions (as
  opposed to the EdenAI-routed `chat` capability `runTranslationDelta`
  uses now) — the user asked the new Mistral credential/config layer be
  designed generically enough to support this later without a rebuild.
  Not implemented now; `lib/mistral.js`'s comment documents the intent.
- A persistent per-meeting Mistral realtime WebSocket session (instead of
  one session per HTTP chunk) — see design.md's "Session Architecture"
  section for why the simpler approach was chosen first; revisit only if
  real-world per-chunk connection overhead turns out to matter at scale.
- Native diarization/vocabulary from Mistral's realtime product — out of
  scope, matching the same "provider swap only" boundary every other
  transcription-shaped migration in this sequence has kept.

## Capabilities

### New Capabilities

- `mistral-provider`: direct Mistral integration, live-meeting STT only
  so far.

### Modified Capabilities

- `edenai-provider`: `liveTranscription` is confirmed **excluded**
  permanently — `EDENAI_HARDCODED_MODEL.liveTranscription` stays `null`
  by design, not by omission (see lib/edenai.js's comment).
- `budget-runtime`: `checkpointMeetingStt` becomes provider-aware
  (Mistral, not OpenRouter).

## Impact

- New: `lib/mistral.js`, `pages/api/organizations/integrations/
  mistral.js`, `pages/api/organizations/integrations/mistral/test.js`,
  `components/settings/MistralIntegrationPanel.js`
- Changed: `services/voxtral-bridge/main.py`,
  `services/voxtral-bridge/Dockerfile`, `lib/integrations.js`,
  `lib/settings-service.js`, `lib/budget-runtime.js`,
  `lib/vexa-bridge.js`, `pages/api/internal/whisper-config.js`,
  `pages/settings/organization/integrations.js`, `.env.example`,
  `config/docker-compose.prod.yml`, `config/docker-compose.dev.yml`
- Unchanged: `lib/vexa-webhook-signature.js`, `pages/api/webhooks/
  vexa.js`, `lib/vexa-reconcile-worker.js` (all authenticate/reconcile the
  Vexa-Lite↔webapp channel, independent of which STT vendor sits behind
  the bridge)
