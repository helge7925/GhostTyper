# Tasks: Add EdenAI Provider Foundation

## 1. Provider Client And Config

- [x] 1.1 `lib/edenai.js`: `EDENAI_BASE_URL` (`https://api.edenai.run/v3`
  — v3, confirmed current; v2 is legacy and never used for AI calls),
  `EDENAI_CAPABILITIES` (`chat`, `translation`, `ocr`, `transcription`,
  `liveTranscription`, `tts`), and the capability→EdenAI model-string-shape
  map (`chat` uses `provider/model-id` against `/llm/chat/completions`; the
  other five use `category/feature/provider` against `/universal-ai`(
  `/async`)). No static provider registry — see 1.3.
- [x] 1.2 `normalizeEdenAiConfig`/`validateEdenAiGovernanceConfig`,
  reusing `normalizeModelId`/`MODEL_ID_PATTERN` from `lib/openrouter.js`.
- [x] 1.3 `getEdenAiCatalogue({apiKey, organizationId, capability,
  allowStale, force})`: live-fetches `GET /v3/models` (`chat`) or
  `GET /v3/info` (other capabilities), normalizes to GhostTyper's model
  shape, 10-minute fresh / 24-hour stale in-memory cache mirroring
  `getOpenRouterCatalogue`. `resolveConfiguredEdenAiModel(config,
  capability, requestedModel)` mirrors `resolveConfiguredModel`. Also
  added (pulled forward from 1.4, since the catalogue fetch itself needs
  them): `EdenAiError`, `edenAiHeaders`. **The exact `/v3/models`/
  `/v3/info` response envelope is unconfirmed** (no published example
  body found even after checking EdenAI's own `edenai-skill` and
  `cookbook` GitHub repos) — the normalizer is deliberately tolerant
  (`data`/`results`/bare-array) rather than asserting one shape; see
  status.md.
- [x] 1.4 `edenAiJsonRequest`,
  `submitEdenAiAsyncJob`/`pollEdenAiAsyncJob` against
  `POST /v3/universal-ai/async` and `GET /v3/universal-ai/async/{job_id}`.
  Chat requests target `POST /v3/llm/chat/completions` (confirmed via
  EdenAI's own cookbook notebooks — note the `/llm/` segment SKILL.md's
  prose omits). Job-id field is `public_id`, not `job_id` (also
  confirmed via cookbook code, also contradicting SKILL.md's prose).
  `submitEdenAiAsyncJob`/`pollEdenAiAsyncJob` are deliberately single-shot
  (no internal poll loop/backoff) — later adapters (batch/live STT) own
  the poll cadence by calling `pollEdenAiAsyncJob` repeatedly.
- [x] 1.5 `lib/edenai-service.js`: create as an empty scaffold module with
  a header comment noting it grows one export per later migration change.
- [x] 1.6 `lib/edenai-probes.js`: `probeEdenAiCapability({apiKey,
  capability, model, input})`. Chat's probe payload is built internally
  (confirmed OpenAI-compatible shape); every universal-ai capability
  requires the caller to supply `input` explicitly rather than guessing
  its per-feature shape — async capabilities (transcription/
  liveTranscription) are probed via `submitEdenAiAsyncJob` and treat
  `pending`/`processing`/`success` as pass, only `failed` as a probe
  failure (this is a connectivity/auth check, not a wait-for-completion
  check).
- [x] 1.7 `lib/settings-service.js`: add `resolveEdenAiConfig({userId,
  organizationId, includeDisabled})`, mirroring `resolveOpenRouterConfig`
  — **except** for a field-ordering bug found in the original while
  mirroring it (an object-spread placed after the computed `apiKey` key
  silently overwrote it back to `null`/the raw stored value in the
  operator-fallback and disabled-integration cases); `resolveEdenAiConfig`
  is written with the corrected ordering. The same bug in
  `resolveOpenRouterConfig` itself is a live, pre-existing issue,
  out of scope for this change — flagged separately, not fixed here.

## 2. Routing

- [x] 2.1 `lib/ai-provider-router.js`: `resolveActiveProviderConfig({
  userId, organizationId, capability})` per design.md's "Provider Routing"
  section — prefers EdenAI only when `enabled && defaultModels[capability]`,
  otherwise resolves OpenRouter, no cross-provider fallback on failure.
  `resolveEdenAi`/`resolveOpenRouter` are injectable (default to the real
  resolvers) for DB-free testing, mirroring this repo's queryFn-injection
  convention. Also completed 5.2 (below) now, alongside this function,
  rather than deferred to group 5.

## 3. Admin API And UI

- [x] 3.1 `pages/api/organizations/integrations/edenai.js` (GET/PUT,
  mirrors `openrouter.js`'s route shape and `meeting.admin` permission
  gate). `pickUpdate` deliberately excludes `activatedCapabilities` —
  only `activate.js` (3.3) may set it, never a plain config PUT (see the
  Group 2 `activatedCapabilities` correction above and design.md).
  Governance-changing PUTs loop `getEdenAiCatalogue` once per capability
  with allowlisted models (EdenAI's catalogue call is per-capability,
  unlike OpenRouter's single fetch-all-then-filter).
- [x] 3.2 `pages/api/organizations/integrations/edenai/test.js`
  (mirrors `openrouter/test.js`: force-refreshes the EdenAI catalogue per
  capability, counts models, returns `{ok, counts, fetchedAt}`).
- [x] 3.3 `pages/api/organizations/integrations/edenai/activate.js`
  (per-capability body `{capability}`, never disables OpenRouter, sets
  `activatedCapabilities` on success). Runs catalogue-availability +
  pricing pre-flight (section 4) for every capability, but the live
  capability **probe** only runs for `chat` (no input needed) and `tts`
  (confirmed self-contained `{text}` input) — translation/ocr/
  transcription/liveTranscription have no confirmed, honestly-fabricable
  probe `input` yet (STT/OCR would need a real audio/document resource;
  translation's field names are unconfirmed), so activation for those
  four succeeds on catalogue+pricing checks alone, `probed: false` in the
  response. The catalogue fetch itself is still a real authenticated
  EdenAI call, so this is a narrower gap than "no verification at all" —
  each capability's own migration change closes it once it knows the
  real `input` shape it's building against.
- [x] 3.4 `pages/api/models.js`: add `provider` query parameter (default
  `openrouter`), branch to `getEdenAiCatalogue` for `provider=edenai`.
  EdenAI model entries carry no `priceAvailable` field (no live
  per-unit-price catalogue to derive it from, unlike OpenRouter's).
- [x] 3.5 `components/settings/EdenAiIntegrationPanel.js`: mirrors
  `OpenRouterIntegrationPanel.js`'s layout and live-catalogue-fetch
  behavior, ships with every capability's allowlist empty. Differs from
  the OpenRouter panel in two ways forced by the design: one activate
  button **per capability card** (not one global "Cutover" button, since
  EdenAI activation is per-capability) showing an "Aktiviert"/"Nicht
  aktiviert" badge from `activatedCapabilities`; the TTS voice field is a
  plain text input with no suggestion list (EdenAI's catalogue has no
  `supportedVoices` field the way OpenRouter's does).
- [x] 3.6 `pages/settings/organization/integrations.js`: render the new
  panel alongside the existing OpenRouter/Vexa panels.

## 4. Pricing Gate

- [x] 4.1 New EdenAI-only `OPERATIONS` map (`lib/edenai-pricing.js`'s
  `EDENAI_OPERATIONS`, lives next to but separate from
  `lib/openrouter-pricing.js`'s existing map — EdenAI has its own
  `translation` capability rather than routing translation-shaped
  operations through `chat`). Completed alongside 3.3, which needs it.
- [x] 4.2 `lib/edenai-pricing.js`'s `findMissingEdenAiPrices` (used by
  `.../edenai/activate.js`'s pre-flight): calls `resolveProviderPrice({
  provider:'edenai', model, operation})` for every `(model, operation)`
  pair the target capability would bill, collecting **every** missing
  pair (not just the first, unlike `syncAllowedOpenRouterPrices`'s
  single-error-and-stop pattern) into a `PRICE_OVERRIDE_REQUIRED`
  response. `resolveProviderPrice` is injectable for DB-free testing,
  same convention as `resolveActiveProviderConfig`. Completed alongside
  3.3, which needs it — no auto-creation logic (unlike OpenRouter's
  sync), since EdenAI has no live rate catalogue to derive a price from.
- [x] 4.3 Document the manual pricing-entry runbook (which admin creates
  which `/admin/prices` rows, when) — operational documentation, not code.
  Done as design.md's new "Manual Pricing-Entry Runbook" section: who
  (platform admin, not org admin), when (before first activation attempt
  per capability), how to derive the exact `(model, operation)` pairs from
  `EDENAI_OPERATIONS` + the capability's `defaultModels` entry, how to
  convert a published EdenAI rate to `*_price_per_million_micros`, a
  worked `POST /admin/prices` example, and the ongoing no-staleness-alert
  caveat.

## 5. Tests

- [x] 5.1 `tests/edenai.test.mjs`: config normalization/governance
  validation, mirroring `tests/openrouter.test.mjs`'s coverage for the
  OpenRouter equivalents, `global.fetch` mocked per test. Done as part
  of tasks 1.2–1.4 (24 tests total).
- [x] 5.2 `tests/ai-provider-router.test.mjs`: EdenAI chosen only when
  `enabled && defaultModels[capability]`; OpenRouter fallback otherwise;
  no silent cross-provider substitution on a simulated EdenAI failure.
  Done alongside 2.1 (6 tests).
- [x] 5.3 `tests/edenai-pricing-gate.test.mjs`: activation rejected with
  the correct missing `(model, operation)` pairs; activation succeeds once
  all pairs are priced. Extends `tests/edenai-pricing.test.mjs`'s existing
  chat/tts coverage to the four remaining capabilities
  (translation/ocr/transcription/liveTranscription), plus an explicit
  assertion that `activate.js`'s `PRICE_OVERRIDE_REQUIRED` response shape
  matches the gate function's real output (6 tests).
- [x] 5.4 Secret non-disclosure test for the EdenAI GET/PUT routes
  (mirrors the equivalent OpenRouter test): API key never appears in a
  JSON response, only `apiKeyConfigured: true`. **Scope note**: no
  equivalent OpenRouter route-level test actually exists to mirror — no
  test in this suite invokes any `pages/api` handler directly, and this
  route has no injectable seam for its collaborators. `tests/edenai-secrets.test.mjs`
  instead tests `redactConfig` (the generic, provider-agnostic function
  both the GET and PUT handlers call as their last step before responding)
  against a real `normalizeEdenAiConfig` output — the actual choke point
  that prevents the leak, without inventing new route-mocking infra (3
  tests). See status.md.

## 6. Verification

- [x] 6.1 `npm run lint` and the full Node test suite (`npm test`) pass.
  Verified 2026-08-28: lint clean, 432 tests / 422 pass / 10 skipped / 0
  failed.
- [x] 6.2 Manual check: with EdenAI unconfigured, every existing workload
  (chat, OCR, transcription, translation, TTS) behaves exactly as before
  this change — no observable difference. Verified 2026-08-28 two ways:
  (a) `grep` confirms zero production call sites reference
  `resolveActiveProviderConfig`/`lib/edenai-service.js` yet — the router
  exists but nothing routes through it until later migration phases, so
  no existing workload's behavior can differ, by construction; (b) in an
  isolated throwaway environment (see 6.3), logged into a fresh account
  with EdenAI completely unconfigured and confirmed the dashboard and
  every existing panel render and behave normally.
- [x] 6.3 Manual check: configuring an EdenAI key and activating one
  capability (with its pricing pre-flight satisfied) succeeds and is
  visible in the admin panel, without affecting any other capability or
  disabling OpenRouter. Verified live 2026-08-28 end-to-end, real
  EdenAI API calls throughout (sandboxed key), against an isolated
  throwaway Postgres + `next dev` instance (never the user's real
  environment — separate container name/port/DB, torn down after):
  entered the API key → saved → real catalogue fetch for all 6
  capabilities (all 200 OK, real model lists matching independently
  curl-verified data) → allowlisted `audio/tts/deepgram/aura-2` for
  `tts` → activation correctly **blocked** with `PRICE_OVERRIDE_REQUIRED`
  naming all 4 missing `(model, operation)` pairs (the Pricing Gate
  working exactly as designed) → created the 4 price rows via
  `/admin/prices` (confirming task 4.3's runbook is accurate) → retried
  → `{ok:true, capability:'tts', probed:true}` (a real live EdenAI probe
  ran and passed) → GET confirmed `enabled:true`,
  `activatedCapabilities:['tts']` only, every other capability still
  unactivated, and OpenRouter's own config completely untouched
  (`enabled:false`, unchanged) → UI shows "Aktiv"/"Aktiviert" badges
  correctly scoped to just TTS. Also incidentally re-confirmed the
  secret-redaction behavior live (`apiKeyConfigured:true`, no `apiKey`
  in any response).
- [x] 6.4 `openspec validate add-edenai-provider-foundation --strict`
  passes. Verified 2026-08-28.
