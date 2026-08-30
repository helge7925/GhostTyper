# Status: Migrate Live Meeting Transcription To EdenAI

Last updated: 2026-08-30

## Current State

- **Implemented**, real EdenAI/OpenRouter latency measurement complete
  and decisive — **outcome is direct Mistral, not EdenAI**. Three manual-
  verification tasks remain (real-meeting end-to-end, `usage_log` check,
  pricing runbook row) — same "code done, real-workspace smoke-test
  still open" state every prior change in this sequence finished in.
  Fifth and last of the originally-planned EdenAI workload migrations;
  the highest-risk one, as anticipated, though the risk resolved
  differently than expected (a genuine architecture mismatch requiring a
  different provider entirely, not a tuning problem within EdenAI).

## Design correction: EdenAI and OpenRouter both rejected on latency; Mistral direct instead (2026-08-30)

This change's original plan (bounded poll inside the synchronous bridge
handler, EdenAI async job submit+poll) was evidence-driven from the
start — Go/No-Go gate, numeric target, documented "stay on OpenRouter"
fallback. The measurement ran as planned and returned a clear No-Go for
EdenAI: even the fastest of 3 vendors tested (openai, no polling needed
for a short clip) took 3.5-4.5s round-trip against a ~2-3s chunk-arrival
cadence — gladia (already chosen for batch transcription) took
4.8-8.6s. The user independently tested OpenRouter (the documented
fallback) and confirmed it isn't meaningfully faster either — both
No-Go.

Rather than stop at "live-meeting STT stays wherever it currently is"
(the plan's own documented acceptable outcome), the user proposed a
third option this plan hadn't considered: Mistral's own realtime
transcription product, called directly — bypassing both OpenRouter's
gateway and EdenAI's aggregation entirely. Researched
(`voxtral-mini-transcribe-realtime-2602`, WebSocket streaming API,
sub-200ms configurable latency per Mistral's own docs, Apache-2.0, GA)
and measured: 0.76-1.5s for chunks up to ~6s, fed as fast as the bridge
can send them (not throttled to real-time playback — the whole point is
Vexa already has each chunk fully recorded before POSTing it). Decisive
GO. Full evidence tables in design.md.

This is a genuinely different kind of finding than the earlier
"dedicated-feature vs. chat" pivots in `migrate-translation-to-edenai`/
`migrate-ocr-extraction-to-edenai` (both of which stayed within the
EdenAI/OpenRouter provider pair) — here, *neither* existing provider
integration could meet the bar, and the fix required introducing a
genuinely new, third provider category into the codebase. Flagged
explicitly since it's the first time this migration sequence has needed
that.

## Implementation (2026-08-30)

- **New direct-Mistral integration** (`lib/mistral.js`,
  `resolveMistralConfig` in `lib/settings-service.js`,
  `pages/api/organizations/integrations/mistral(.js|/test.js)`,
  `components/settings/MistralIntegrationPanel.js`) — its own
  `organization_integrations` provider row (`'mistral'`), its own
  `MISTRAL_API_KEY` operator fallback, no per-capability activation
  dance (unlike EdenAI) since there's exactly one consumer so far.
  Deliberately generic config shape per the user's explicit request that
  this be reusable for live-meeting *translation* later without a
  rebuild — see lib/mistral.js's comment.
- `services/voxtral-bridge/main.py`: rewritten. Decodes Vexa's
  compressed audio (webm/opus) to raw PCM via `ffmpeg`
  (`asyncio.to_thread`-wrapped `subprocess.run`), opens one Mistral
  realtime WebSocket session per incoming HTTP chunk via
  `mistralai[realtime]`'s `transcribe_stream`, returns
  `{"text": "..."}` once `transcription.done` arrives — no manual
  delta-concatenation needed, that event already carries the full
  transcript. Context-bias/vocabulary forwarding was **not** ported
  (Mistral's realtime protocol has no documented equivalent to
  OpenRouter's Groq-specific best-effort passthrough) — logged when
  configured but unused, not silently dropped. `Dockerfile` gained
  `ffmpeg` (apk) and `mistralai[realtime]==2.9.4` (pip).
- **Session architecture**: one realtime session per HTTP chunk, not a
  persistent per-meeting connection. Considered the persistent-session
  design (architecturally "correct" for a protocol built around
  continuous streaming) and deliberately deferred it — the simpler
  per-chunk approach already measures well inside the latency budget
  with real headroom, and avoids introducing session-lifecycle state
  management this codebase doesn't have for STT today. Recorded as the
  documented next step if per-chunk connection overhead becomes a
  problem at higher concurrent-meeting scale (not observed here —
  single-request testing only).
- `lib/integrations.js`'s `resolveBridgeTranscriptionConfig()`: resolves
  Mistral exclusively — no provider branching, no OpenRouter/EdenAI
  fallback (per the user's explicit "ausschließlich Mistral" direction,
  a deliberate exception to this migration's general "prefer EdenAI once
  activated, else OpenRouter" pattern).
- `lib/budget-runtime.js`'s `checkpointMeetingStt()`: bills
  `provider:'mistral'` unconditionally — previously hardcoded
  `'openrouter'` three times, meaning a meeting's billing checkpoint
  failed outright if OpenRouter wasn't configured regardless of what the
  bridge actually used.
- `lib/vexa-bridge.js`'s `runTranslationDelta()` (deferred from
  `migrate-translation-to-edenai`, landed here as planned): now routes
  through `resolveActiveProviderConfig({capability:'chat'})` — not
  `'translation'` as the original plan assumed, since translation has no
  EdenAI capability of its own (see that change's own design
  correction). Branches `translateTextSegments`/
  `translateTextSegmentsEdenAi`, reusing the already-tested EdenAI
  adapter unchanged. This is unrelated to the new direct-Mistral
  integration above — two different "Mistral" paths now exist in this
  codebase (EdenAI's aggregated `chat` capability, which happens to use
  `mistral-small-latest` as its backend, vs. this change's direct
  integration) for two different reasons; see design.md's closing risk
  note.
- `pages/api/internal/whisper-config.js`: response shape simplified
  (`apiKey`/`model`/`contextBias`/`source`/`organizationId` — dropped
  `baseUrl`/`verboseJson`, OpenRouter REST concepts with no realtime-WS
  equivalent).
- `.env.example`, `config/docker-compose.{prod,dev}.yml`: `MISTRAL_API_KEY`
  added, dead `OPENROUTER_LIVE_TRANSCRIPTION_MODEL` removed,
  `api.mistral.ai` added to `OUTBOUND_ALLOWED_HOSTS`, bridge service env
  block updated (`MISTRAL_MODEL_OVERRIDE`/`REALTIME_TIMEOUT_S` replacing
  `UPSTREAM_URL`/`MODEL_OVERRIDE`/`UPSTREAM_TIMEOUT_S`).
- Tests: new `tests/mistral.test.mjs` (3 tests),
  `tests/settings-service.test.mjs` gained `resolveMistralConfig`
  operator-fallback coverage (2 tests, mirroring the existing
  EdenAI/OpenRouter tests' documented DB-dependency limitation).
  `tests/openrouter.test.mjs`'s pre-existing "no fixed model ids or
  legacy inference hosts" regression guard — which this change's own
  `voxtral-bridge/main.py`/`docker-compose.prod.yml` edits newly
  triggered, since it was written to catch exactly this class of
  reintroduced direct-provider reference — split into two tests: the
  original guard, now correctly scoped to the actual OpenRouter-facing
  app files only, plus a new test confirming the bridge references
  exactly the current realtime model and nothing legacy. `npm test` →
  464 tests / 452 pass / 12 skipped / 0 failed (up from 458/446/12/0).
  Lint clean.
- Verification: live-called the actual shipped bridge (`main.py`, run as
  a real `uvicorn` server in an isolated environment, not a
  reimplementation) with a real webm/opus multipart request matching
  Vexa-Lite's exact request shape, against production Mistral — correct
  transcript, 1.1-1.4s round trip, reproducible across 3 runs. The
  missing-API-key → 503 error path also verified live against a second
  server instance. Key deleted from scratchpad immediately after each of
  the three uses this round (initial EdenAI/OpenRouter comparison,
  Mistral realtime API research/measurement, final shipped-bridge
  smoke test), no leak (repo-wide grep clean every time).
- `openspec validate migrate-live-meeting-stt-to-edenai --strict` passes.

## Pricing gate closed (2026-08-30)

The two items flagged above as open have been addressed:

- **Activation/pricing gate**: `lib/mistral-pricing.js` (new,
  `findMissingMistralPrices` — mirrors `lib/edenai-pricing.js`'s
  `findMissingEdenAiPrices` for Mistral's one operation,
  `meeting_transcription`) is now called from
  `pages/api/organizations/integrations/mistral.js`'s PUT handler
  whenever the resulting config would have a non-null `apiKey`. Since
  Mistral has no separate activation step — a saved key *is* the
  activation moment — the gate blocks the key from being persisted at
  all (`400 PRICE_OVERRIDE_REQUIRED`, same shape as EdenAI's
  `activate.js`) until the price row exists. Closes the gap: a workspace
  can no longer go live for real meetings with no price row configured.
  `tests/mistral-pricing.test.mjs` covers the gate function directly
  (same scope precedent as `tests/edenai-pricing-gate.test.mjs` — no
  module-mocking route-handler test exists in this suite to reach for
  instead).
- **Price row values researched and documented** (were previously not
  recorded anywhere — the earlier "$0.006/min" figure only existed in
  conversation, not in any file): confirmed via Mistral's own model docs
  (`docs.mistral.ai/models/voxtral-mini-transcribe-realtime-26-02`),
  **$0.006 per minute of audio**. Converted to this app's
  `provider_price_versions` shape (`inputUnit`/`inputPricePerMillionMicros`
  bill audio duration — see `lib/pricing-core.js`'s
  `normalizeProviderUsage`, which maps `usage.audio_duration_seconds` to
  `inputQuantity`):
  - `$0.006/min ÷ 60 = $0.0001/audio_second`
  - `$0.0001 × 1,000,000 (micros/USD) × 1,000,000 (per-million-unit basis) / 1,000,000 = 100,000,000` micros per million `audio_second`
  - **Exact runbook values**: `provider=mistral`,
    `model=voxtral-mini-transcribe-realtime-2602`,
    `operation=meeting_transcription`, `inputUnit=audio_second`,
    `inputPricePerMillionMicros=100000000`, `outputUnit=audio_second`
    (dummy — no output quantity is ever reported for STT, so this unit
    choice is unused but required by `validatePriceVersion`),
    `outputPricePerMillionMicros=0`.
  - **Not created in the database by this change** — same as every
    other price row in this migration sequence (see
    `migrate-batch-transcription-to-edenai/status.md`'s identical
    treatment of the `gladia` row): this is real billing configuration
    on whatever database this deployment points at, entered manually via
    the existing `/admin/prices` UI with a mandatory audit `reason`, not
    something to script or insert directly. The values above are ready
    to paste in as-is.

## Outstanding

- Admin runbook: create the price row using the exact values documented
  above via `/admin/prices` before activating Mistral for any real
  workspace — the new pricing gate will refuse to save an API key until
  this row exists, so this is now a hard precondition, not just a
  suggestion.
- Tasks 7.2/7.3: full real-meeting end-to-end verification (bot joins a
  real platform, live captions appear, meeting finalizes,
  `usage_log` shows `provider='mistral'` rows) — not yet run. Task 7.1
  already verified the STT call itself works correctly against
  production; this is the remaining full-integration check (Vexa-Lite
  bot + bridge + webapp + billing), same open-item pattern as every
  other change in this migration sequence.
- No `pytest` suite exists for the bridge (see tasks.md's 6.1) — real
  live-server verification was done instead (arguably stronger evidence
  for this specific risk), but it isn't a repeatable CI check. A
  follow-up pytest suite (mocking the Mistral SDK) would close this gap
  properly.
- Context-bias/vocabulary forwarding and diarization/segments are both
  real, acknowledged feature gaps relative to what the OpenRouter path
  had (best-effort) or what Mistral's realtime API could in principle
  provide (`TranscriptionStreamDone.segments` exists, unused) — see
  design.md's Risks section.
- Persistent per-meeting WebSocket sessions (vs. the current per-chunk
  session) remain a documented, not-yet-needed optimization — see
  design.md's "Chosen Architecture" section for the reasoning and the
  trigger condition for revisiting it.
- Live-meeting translation via *direct* Mistral (as opposed to the
  EdenAI-routed `chat` capability `runTranslationDelta` uses today) is
  explicitly deferred — the credential layer is built to support it, the
  feature itself is not implemented.
