# Tasks: Migrate Live Meeting Transcription To EdenAI

**Actual outcome**: direct Mistral, not EdenAI — see proposal.md/design.md.
Tasks below reflect what was actually built; struck-through-in-spirit
items from the original EdenAI-adapter plan are marked "changed from the
original plan" rather than silently rewritten.

## 1. Go/No-Go Measurement — Done First, Decided The Rest

- [x] 1.1 Measured EdenAI (3 vendors) and confirmed via the user's own
  testing that OpenRouter isn't faster either — both No-Go for a ~2-3s
  chunk cadence. Full numbers in design.md.
- [x] 1.2 Researched and measured Mistral's direct realtime transcription
  product (`voxtral-mini-transcribe-realtime-2602`) — 0.76-1.5s,
  comfortably inside budget. GO.
- [x] 1.3 Measured the end-to-end pipeline, not just the raw API: webm→PCM
  transcode (~11ms, negligible) plus the actual shipped bridge code
  (not a hand-rolled script) running as a live server against a real
  webm/opus request — 1.1-1.4s total, reproducible across 3 runs.

## 2. Direct Mistral Integration (new, not in the original plan)

- [x] 2.1 `lib/mistral.js`: `MISTRAL_LIVE_TRANSCRIPTION_MODEL` constant,
  `normalizeMistralConfig` — deliberately generic (not STT-specific),
  per the user's request that this be reusable for live-meeting
  translation later.
- [x] 2.2 `lib/settings-service.js`: `resolveMistralConfig` (org key →
  `BRIDGE_TRANSCRIPTION_API_KEY`/`MISTRAL_API_KEY` operator fallback),
  mirroring `resolveOpenRouterConfig`/`resolveEdenAiConfig`'s shape.
- [x] 2.3 `pages/api/organizations/integrations/mistral.js` (GET/PUT) and
  `mistral/test.js` (connectivity check via a plain REST call, not a
  realtime WS handshake), `components/settings/MistralIntegrationPanel.js`,
  wired into `pages/settings/organization/integrations.js`.

## 3. Bridge Rewrite (replaces the originally-planned EdenAI adapter)

- [x] 3.1 **Changed from the original plan** — no
  `services/voxtral-bridge/edenai_client.py` submit/poll adapter was
  built. Instead, `main.py`'s `proxy()` was rewritten: decode Vexa's
  compressed audio to PCM via `ffmpeg`, open one Mistral realtime
  WebSocket session per HTTP chunk via `mistralai[realtime]`'s
  `transcribe_stream`, return `{"text": "..."}` once
  `transcription.done` arrives.
- [x] 3.2 `services/voxtral-bridge/Dockerfile`: added `ffmpeg` (apk) and
  `mistralai[realtime]==2.9.4` (pip).
- [x] 3.3 Error handling: `no_api_key` → 503, transcode failure → 502,
  Mistral connection/transcription failure → 502 — verified live against
  the real running server (missing-key case explicitly tested).

## 4. Webapp-Side Wiring

- [x] 4.1 `lib/integrations.js`'s `resolveBridgeTranscriptionConfig()`:
  resolves Mistral exclusively — **changed from the original plan**
  (no `resolveActiveProviderConfig({capability:'liveTranscription'})`
  call, since there is no fallback branching for this capability at
  all, per the user's "exclusively Mistral" direction).
- [x] 4.2 `lib/budget-runtime.js`'s `checkpointMeetingStt()`: replaced
  `resolveOpenRouterConfig` and the three `provider:'openrouter'`
  literals with `resolveMistralConfig`/`provider:'mistral'`.
- [x] 4.3 `lib/vexa-bridge.js`'s `runTranslationDelta()`: switched its two
  `provider:'openrouter'` sites to
  `resolveActiveProviderConfig({capability:'chat'})` (not `'translation'`
  as the original plan assumed — translation has no capability of its
  own, see `migrate-translation-to-edenai`), branching
  `translateTextSegments`/`translateTextSegmentsEdenAi`.
- [x] 4.4 `pages/api/internal/whisper-config.js`: response shape
  simplified to `apiKey`/`model`/`contextBias`/`source`/`organizationId`
  — dropped `baseUrl`/`verboseJson` (OpenRouter REST-specific, no
  realtime-WS equivalent).
- [x] 4.5 **Changed from the original plan** — no EdenAI `OPERATIONS`
  map entries for `liveTranscription`/`live_translation` were added:
  `liveTranscription` is excluded from EdenAI entirely (Mistral direct
  instead, no operation-pricing entry needed there); `live_translation`
  was already added to `EDENAI_OPERATIONS.chat` during this same session
  (see `lib/edenai-pricing.js`, added alongside `translation`/
  `office_translation` in an earlier phase).
- [x] 4.6 `.env.example`, `config/docker-compose.{prod,dev}.yml`: added
  `MISTRAL_API_KEY`, removed the now-dead
  `OPENROUTER_LIVE_TRANSCRIPTION_MODEL`, added `api.mistral.ai` to
  `OUTBOUND_ALLOWED_HOSTS`, updated the bridge service's env block
  (`MISTRAL_MODEL_OVERRIDE`, `REALTIME_TIMEOUT_S` replacing
  `UPSTREAM_URL`/`MODEL_OVERRIDE`/`UPSTREAM_TIMEOUT_S`).

## 5. Pricing

- [x] 5.1 `lib/mistral-pricing.js` (new): `findMissingMistralPrices`,
  mirroring `lib/edenai-pricing.js`'s `findMissingEdenAiPrices` for
  Mistral's one operation (`meeting_transcription`). Wired into
  `pages/api/organizations/integrations/mistral.js`'s PUT handler: since
  Mistral has no separate activation step (a saved key is always
  active), the gate runs there and refuses to persist the key
  (`400 PRICE_OVERRIDE_REQUIRED`) until the price row exists — closes
  the gap flagged in status.md where a saved key went live with no
  pricing pre-flight. `tests/mistral-pricing.test.mjs` covers the gate
  function.
- [ ] 5.2 Admin runbook: create the `(mistral,
  voxtral-mini-transcribe-realtime-2602, meeting_transcription)` price
  row before activating live-meeting STT for any workspace. Not yet
  done — no workspace has activated this yet, and per 5.1 the app will
  now refuse to let it happen without this row anyway. Note: this is a
  NEW provider in `provider_price_versions`, not an existing EdenAI/
  OpenRouter row extended. Exact values (researched against Mistral's
  own docs, $0.006/min) are documented in status.md, ready to paste into
  `/admin/prices`.

## 6. Tests

- [x] 6.1 **Changed from the original plan** — no
  `services/voxtral-bridge/tests/` pytest suite was added (no
  `edenai_client.py` exists to test). The bridge's actual behavior was
  instead verified live end-to-end (task 1.3) against a real running
  server, which is a stronger check than a mocked unit test would have
  been for this specific risk (real WebSocket protocol, real audio
  transcode) — but it is not a repeatable, CI-run test, which is a real
  gap flagged in status.md's Outstanding section, not silently accepted.
- [x] 6.2 `tests/mistral.test.mjs`: `normalizeMistralConfig`/
  `MISTRAL_LIVE_TRANSCRIPTION_MODEL` (3 tests).
  `tests/settings-service.test.mjs`: `resolveMistralConfig` operator-
  fallback coverage (2 tests), mirroring the existing
  `resolveEdenAiConfig`/`resolveOpenRouterConfig` pattern exactly
  (including its documented limitation: the organization-scoped branch
  needs a real database and isn't unit-tested here either).
- [x] 6.3 `tests/openrouter.test.mjs`'s "no fixed model ids or legacy
  inference hosts" regression guard: split into two tests — the
  original guard now scoped to the actual OpenRouter-facing app files
  only, plus a new test confirming `voxtral-bridge/main.py`/
  `docker-compose.prod.yml` reference the current realtime model
  (`voxtral-mini-transcribe-realtime-2602`) and nothing else, not the
  old Cortecs/legacy-model regression this test was originally guarding
  against being reintroduced.
- [ ] 6.4 No dedicated test for `resolveBridgeTranscriptionConfig()`
  itself (Mistral branch) — its structure requires a real database
  connection even for the "operator fallback" path (unlike
  `resolveOpenRouterConfig`/`resolveEdenAiConfig`, which short-circuit
  before any query when no organizationId is given). Flagged as a
  pre-existing test-coverage gap this change did not introduce, not
  fixed here.

## 7. Verification

- [x] 7.1 Live-called the actual shipped bridge (`main.py`, running as a
  real `uvicorn` server in an isolated environment) with a real
  webm/opus multipart request matching Vexa's exact shape, against
  production Mistral — correct transcript, 1.1-1.4s, reproducible
  across 3 runs. Missing-API-key 503 path also verified live. Key
  deleted from scratchpad immediately after, no leak (repo-wide grep
  clean).
- [ ] 7.2 Manual: run a real meeting end-to-end (bot joins a real
  platform, live captions appear, meeting finalizes on
  `meeting.completed`) — not yet run; task 7.1 verified the STT call
  itself works correctly, this is the remaining full-integration
  (Vexa-Lite bot + bridge + webapp) check. Same open-item pattern as
  every other EdenAI migration in this sequence's final manual-
  verification task.
- [ ] 7.3 Manual: verify `usage_log` records `provider='mistral'` rows
  for `meeting_transcription` through a real meeting. Not yet run.
- [x] 7.4 `npm test` passes (464 tests / 452 pass / 12 skipped / 0
  failed). No `pytest` suite exists (see 6.1) — `python3 -m py_compile`
  used as the syntax gate for `main.py` instead.
- [x] 7.5 `openspec validate migrate-live-meeting-stt-to-edenai --strict`
  passes.
