# Status: Add EdenAI Provider Foundation

Last updated: 2026-08-28

## Current State

- **Complete.** All tasks in `tasks.md` (groups 1–6) are done, including
  6.2/6.3's manual checks, verified live end-to-end against an isolated
  throwaway environment on 2026-08-28 — see the dated entries below.
  `openspec validate add-edenai-provider-foundation --strict` passes.
  First change in a risk-ordered,
  multi-step migration from OpenRouter to EdenAI (translation → batch
  transcription → OCR → live-meeting transcription → chat/analysis/TTS,
  with OpenRouter decommissioned last). This change adds the EdenAI
  integration itself — provider client, per-capability router, admin
  console, manual pricing gate — without moving any workload's traffic.
  Later changes in the sequence depend on this one landing first.

## Corrections found during implementation (2026-08-27)

- **EdenAI does expose a live model catalogue.** This change's original
  draft (written from pre-implementation research) assumed EdenAI had no
  live per-model catalogue API and designed a static, source-controlled
  `EDENAI_PROVIDER_REGISTRY` around that assumption, including a
  `model-governance` spec delta carving out an exception for it. Reading
  EdenAI's own current documentation (the `edenai/edenai-skill` reference
  on GitHub) during task 1.1 showed this was wrong: `GET /v3/models`
  (LLM catalog) and `GET /v3/info` (full feature × provider matrix) are
  both live, authoritative, and explicitly meant to be fetched rather
  than hardcoded. `proposal.md`, `design.md`, and both
  `specs/edenai-provider/spec.md` and `specs/model-governance/spec.md`
  have been corrected accordingly: `lib/edenai.js` now live-fetches a
  catalogue (`getEdenAiCatalogue`, mirroring `getOpenRouterCatalogue`)
  instead of reading a static array, and the `model-governance` delta
  is a straightforward wording generalization rather than a carve-out.
- **v2 vs v3**: EdenAI's AI-facing API is v3
  (`https://api.edenai.run/v3`); v2 is legacy, retained only for
  account-level cost/token endpoints through end of 2026. All research
  and code in this change targets v3.
- **Two model-string shapes confirmed**: chat uses `provider/model-id`
  against `POST /v3/llm/chat/completions` (OpenAI-compatible, including
  `response_format` JSON-schema support — relevant context for
  `migrate-chat-tts-and-decommission-openrouter`'s structured-output-probe
  risk, not re-litigated here). Every other capability uses
  `category/feature/provider` against `POST /v3/universal-ai` (sync) or
  `POST /v3/universal-ai/async` (feature names ending `_async`, notably
  `audio/speech_to_text_async`).
- What did **not** change: EdenAI still has no live *pricing-rate*
  catalogue (only a post-call `cost` field per response), so the manual
  pricing gate (`EdenAI Manual Pricing Gate` requirement) is unaffected
  and still required for reservation-time cost estimates.

## Verified

- Task 1.1: `lib/edenai.js` (`EDENAI_BASE_URL`, `EDENAI_CAPABILITIES`,
  `EDENAI_CAPABILITY_MODEL_SHAPE`, `isEdenAiFeatureAsync`) and
  `tests/edenai.test.mjs` (7 tests).
- Task 1.2: `normalizeEdenAiConfig`/`validateEdenAiGovernanceConfig`/
  `emptyEdenAiModelMap`/`emptyEdenAiDefaultMap` added to `lib/edenai.js`,
  importing `normalizeModelId` from `lib/openrouter.js` (the one
  deliberate shared-code exception per design.md — everything else
  mirrors without importing). 4 more tests added (11 total in
  `tests/edenai.test.mjs`), mirroring `tests/openrouter.test.mjs`'s
  governance-validation test shape. Found and fixed a real bug in the
  same step: the initial `import ... from './openrouter'` (no extension)
  resolves fine under Next.js's bundler but fails Node's strict ESM
  resolver under plain `node --test` — fixed to `'./openrouter.js'`.
- Task 1.3: `getEdenAiCatalogue`, `resolveConfiguredEdenAiModel`,
  `EdenAiError`, `edenAiHeaders` added to `lib/edenai.js`, mirroring
  `getOpenRouterCatalogue`'s fresh/stale cache and
  `resolveConfiguredModel`'s allowlist-then-default-then-throw logic. 7
  more tests added (18 total in `tests/edenai.test.mjs`), including a
  stale-cache-on-fetch-failure test mirroring
  `tests/openrouter.test.mjs`'s equivalent.
- Task 1.4: `edenAiJsonRequest` (generic JSON POST, deliberately no ZDR/
  provider-preference injection — see design.md Risks),
  `submitEdenAiAsyncJob`/`pollEdenAiAsyncJob` (single-shot primitives
  against `POST /universal-ai/async`/`GET /universal-ai/async/{id}`,
  normalizing EdenAI's `status`/`public_id`/`output`/`error` envelope,
  confirmed via cookbook code) added to `lib/edenai.js`. 6 more tests
  added (24 total in `tests/edenai.test.mjs`).
- `node --no-warnings --test tests/edenai.test.mjs` — 24/24 pass.
  `npx eslint lib/edenai.js tests/edenai.test.mjs` clean. Full non-DB
  suite (`node --no-warnings --test tests/*.test.mjs`) 388/388 passing
  (10 pre-existing skips, unrelated to this change).
- Task 1.5: `lib/edenai-service.js` created as an empty scaffold (header
  comment only, no exports yet — nothing to test until the first
  migration change adds its function). `npx eslint lib/edenai-service.js`
  clean.
- Task 1.6: `lib/edenai-probes.js`'s `probeEdenAiCapability` — chat probe
  built internally (confirmed shape), universal-ai probes require an
  explicit `input` from the caller rather than guessing per-feature
  shapes; async capabilities pass on `pending`/`processing`/`success`,
  fail only on `failed`. New `tests/edenai-probes.test.mjs` (8 tests).
  `node --no-warnings --test tests/edenai-probes.test.mjs` — 8/8 pass.
  `npx eslint lib/edenai-probes.js tests/edenai-probes.test.mjs` clean.
  Full non-DB suite 396/396 passing.
- Task 1.7: `lib/settings-service.js`'s `resolveEdenAiConfig` added.
  Writing its test (`tests/settings-service.test.mjs`) surfaced two
  real, pre-existing issues, both handled before moving on:
  - **ESM extensionless-import chain**: `lib/settings-service.js` →
    `lib/integrations.js` → `lib/db.js`/`lib/secrets.js`/
    `lib/model-policy.js`/`lib/openrouter.js` all used extensionless
    relative imports (`from './db'` etc.) — fine under Next.js's bundler,
    but this is the first test to import this chain directly under
    `node --test`, which needs explicit extensions (same class of issue
    fixed for `lib/edenai.js` itself in task 1.2). Fixed the 7
    extensionless imports actually on this import path in
    `lib/settings-service.js` and `lib/integrations.js` (no other files
    touched).
  - **`resolveOpenRouterConfig` object-spread bug**: verified with a
    reproducible Node snippet that placing a computed `apiKey` field
    before a `...config`/`...normalizeOpenRouterConfig({})` spread lets
    the spread silently overwrite it — `resolveOpenRouterConfig({})`
    (no organization) always returns `apiKey: null` regardless of
    `OPENROUTER_API_KEY`, and an org relying on the operator-fallback key
    (a documented, supported pattern) gets the same `null`. A disabled
    integration's real stored key can also leak through where `null` was
    intended. `resolveEdenAiConfig` is written with the field order
    corrected (spread first, computed fields after — see its code
    comment); the pre-existing bug in `resolveOpenRouterConfig` itself is
    **not** fixed by this change (out of scope, affects live OpenRouter
    behavior) — flagged separately as its own task
    (`task_cabaaebf`, "Fix apiKey overwrite bug in
    resolveOpenRouterConfig").
  - Also added `EDENAI_API_KEY` and `api.edenai.run` (to
    `OUTBOUND_ALLOWED_HOSTS`) to `.env.example`.
  - `node --no-warnings --test tests/settings-service.test.mjs` — 2/2
    pass (operator-fallback branch only; the organization-scoped branch
    needs a real database, per the `tests/db/` pattern, and is not
    covered here). `npx eslint` clean on all touched files. Full non-DB
    suite 398/398 passing.
- Task 2.1: `lib/ai-provider-router.js`'s `resolveActiveProviderConfig`.
  `resolveEdenAi`/`resolveOpenRouter` are injectable (default to the real
  resolvers), following this repo's queryFn-injection convention, so the
  routing decision itself is fully unit-testable without a database —
  used the same `DATABASE_URL` placeholder + dynamic-import workaround as
  task 1.7's test, since `lib/ai-provider-router.js` imports
  `lib/settings-service.js` at module scope. New
  `tests/ai-provider-router.test.mjs`, later extended to 7 tests once the
  `activatedCapabilities` gate (below) was added, completing tasks 5.1
  and 5.2 ahead of group 5, alongside this function rather than deferred.
- Tasks 3.1–3.6 (admin routes + UI) and 4.1–4.2 (pricing gate, pulled
  forward — needed by 3.3): new `pages/api/organizations/integrations/
  edenai.js` (+`edenai/test.js`, `edenai/activate.js`),
  `components/settings/EdenAiIntegrationPanel.js`, `lib/edenai-pricing.js`;
  changed `pages/api/models.js` (new `provider` query param) and
  `pages/settings/organization/integrations.js` (renders the new panel).
  New `tests/edenai-pricing.test.mjs` (5 tests) covers the pure
  `EDENAI_OPERATIONS`/`findMissingEdenAiPrices` logic with an injected
  `resolveProviderPrice`.
  **Deliberately not covered by automated tests**: the route handlers
  themselves (`edenai.js`/`test.js`/`activate.js`) — matching this
  repo's existing convention, since the equivalent OpenRouter routes also
  have zero direct test coverage today (that gap is what
  `harden-openrouter-workload-test-coverage` and
  `add-openrouter-admin-console-ui-tests` exist to close, as their own
  dedicated changes, not inline with feature work). Task 5.4 (secret
  non-disclosure test for the EdenAI GET/PUT routes) remains open in
  group 5 for the same reason. Manually reviewed all new route files
  line-by-line instead, and verified relative-import path depths by hand.
  `node --no-warnings --test tests/edenai-pricing.test.mjs` — 5/5 pass.
  `npx eslint` clean on every new/changed file. Full non-DB suite
  421/421 passing.

## Corrections and new findings from task 1.3 research (2026-08-28)

Cross-checked EdenAI's `SKILL.md` prose against real, executable code in
`edenai/cookbook` (10 example notebooks) on GitHub, since `SKILL.md` gives
no example response bodies for `GET /v3/models`/`GET /v3/info`. Found:

- **Chat endpoint path correction**: SKILL.md's prose says
  `POST /v3/chat/completions`. Three independent cookbook notebooks
  (`voice_to_voice_agent`, `document_to_json`, `pii_anonymization`) all
  consistently call `POST /v3/llm/chat/completions` instead — the `/llm/`
  segment is real and SKILL.md's prose omits it. Task 1.4 (not yet
  started) must use `/llm/chat/completions`.
- **Confirmed model-entry field names** (from cookbook prose, not a
  fetched response): `supports_response_schema` and
  `supports_function_calling` boolean flags exist per chat model —
  encoded defensively into `getEdenAiCatalogue`'s normalizer as
  `supportsResponseSchema`/`supportsFunctionCalling`, `Boolean(...)`
  so a missing field just reads `false` rather than throwing.
- **Confirmed async STT job shape** (from `voice_to_voice_agent`'s real
  working code): the launch response's job-id field is `public_id`, not
  `job_id` as SKILL.md's prose says; a short clip can return
  `status: "success"` inline on the launch call itself, without a poll
  round-trip; poll responses use `status` (`success`/`failed`/other) and
  `output.text` for STT. Relevant to task 1.4 and to
  `migrate-batch-transcription-to-edenai`/`migrate-live-meeting-stt-to-
  edenai`'s adapters (not yet started) — noted here so it isn't
  re-researched from scratch later.
- **TTS uses `output.audio_resource_url`** (a URL to download), not
  inline audio bytes — relevant to the future TTS adapter
  (`migrate-chat-tts-and-decommission-openrouter`), not this task.
- **Still genuinely unconfirmed**: the exact JSON envelope `GET /v3/models`
  and `GET /v3/info` return (no cookbook notebook calls either endpoint —
  all use fixed, hardcoded model strings). `getEdenAiCatalogue`'s
  normalizer in `lib/edenai.js` is written defensively (accepts `data`,
  `results`, or a bare array) rather than betting on one shape, and is
  covered by tests using an assumed-but-explicitly-labelled fixture. If
  you have a production EdenAI API key, a real `GET /v3/info` and
  `GET /v3/models` response body pasted here would let this be verified
  precisely instead of inferred — until then, treat the normalizer as
  best-effort.

## Corrections found during Group 3 implementation (2026-08-28)

- **Per-capability activation-gate bug, found before any Group 3 route
  was written**: the router (`resolveActiveProviderConfig`, from Group 2)
  originally checked only `enabled && defaultModels[capability]`. That is
  unsafe once activation is per-capability (EdenAI's model, unlike
  OpenRouter's atomic all-5-at-once activation): after the *first*
  capability is activated, `enabled` becomes true for the whole
  integration, and a later plain `PUT` filling in a *different*
  capability's `defaultModels` entry would silently make that capability
  live too, with no probe or pricing check ever having run for it.
  Fixed by adding `activatedCapabilities` (a list, mutated only by
  `activate.js` on a successful per-capability probe+pricing pass) as the
  real gate; `defaultModels` is now correctly understood as just an
  editable proposal. `lib/edenai.js` (`normalizeEdenAiConfig`),
  `lib/ai-provider-router.js`, and both their tests were updated; the
  Group 2 section above and this change's `design.md`/
  `specs/edenai-provider/spec.md` were corrected accordingly before
  Group 3 code was written on top of them.
- **No confirmed, honestly-fabricable probe `input` for four
  capabilities**: `activate.js` only runs a live `probeEdenAiCapability`
  call for `chat` (needs no input) and `tts` (confirmed `{text}` shape).
  For translation/ocr/transcription/liveTranscription, activation still
  enforces catalogue-availability and pricing checks (and the catalogue
  fetch is itself a real authenticated EdenAI call), but skips the
  capability-specific live probe and reports `probed: false` — closing
  this is left to each capability's own migration change, which will
  know the real `input` shape once it builds that capability's actual
  adapter.

## Catalogue-endpoint correction (2026-08-28, prompted by a user question about a spell-check capability)

While researching whether EdenAI's `text/spell_check` feature should be
added to the plan (see the new `migrate-grammar-check-to-edenai` change),
found EdenAI's own `edenai/docs` GitHub repo's `v3/llms.txt` reference —
a much more detailed source than anything consulted for tasks 1.3/1.6,
with real confirmed request/response examples (not just endpoint names).
It showed task 1.3's catalogue implementation was fetching the wrong
shape entirely:

- `GET /v3/models` (chat) really returns
  `{models: [{provider, models: [bareName, ...]}, ...]}` — grouped by
  provider, bare model names. `getEdenAiCatalogue` was treating the
  response as a flat `data`/`results`/bare array of `{id, ...}` entries
  and never composing `provider/model`. Fixed.
- The flat `GET /v3/info` this design used for every non-chat capability
  actually returns only feature *names* per category (confirmed example:
  `{text: ["spell_check", "embeddings", ...], translation:
  ["document_translation"], ...}`), not provider/model entries — so the
  "fetch once, filter by id prefix" approach never had real catalogue
  data to filter. The real per-capability endpoint is
  `GET /v3/info/{category}/{subfeature}?format=simplified` →
  `{models: ["category/subfeature/provider", ...]}`. Fixed:
  `EDENAI_CAPABILITY_MODEL_SHAPE` now carries `category`/`subfeature` as
  separate fields (was one combined `feature` string), the flat-fetch +
  client-side-filter code path is removed entirely, and
  `isEdenAiFeatureAsync` is now called with the bare `subfeature`.
- Also removed the speculative `supportsResponseSchema`/
  `supportsFunctionCalling` catalogue fields added in task 1.3 — the now
  confirmed `GET /v3/models` shape does not carry them; that gap is
  (and always was, per the Chat Adapter design in
  `migrate-chat-tts-and-decommission-openrouter`) meant to be closed by
  an activation-time probe, not a catalogue field.

`lib/edenai.js`, `lib/edenai-probes.js`, and their tests were updated;
`node --no-warnings --test tests/*.test.mjs` — 413/413 passing after the
fix, `npx eslint` clean.

**Still unresolved, spotted during the same research pass, not acted on**:
EdenAI's own documentation sources disagree on the chat endpoint's exact
path — `edenai/docs`' `llms.txt` and the `edenai-skill` reference both say
`POST /v3/chat/completions`, while three independent `edenai/cookbook`
notebooks (real, executable code) consistently use
`POST /v3/llm/chat/completions`, which is what this codebase currently
uses (`edenAiJsonRequest`'s chat call site). Left unchanged given the
split evidence — activation's chat probe (task 1.6) will surface a wrong
path immediately (as a 404/`MODEL_UNAVAILABLE`) the first time a real key
activates chat, so this is self-correcting at that point rather than
silently wrong.

## Groups 4–6 completed (2026-08-28)

- **4.3**: added a "Manual Pricing-Entry Runbook" section to `design.md`
  (between "Activation And Pricing Gate" and "Admin Console") — who
  (platform admin via `/admin/prices`, not the org admin who activates the
  capability), when (before the first activation attempt per capability),
  how to derive the exact `(model, operation)` pairs from
  `EDENAI_OPERATIONS` + the capability's proposed `defaultModels` entry,
  how to convert a published EdenAI rate to
  `*_price_per_million_micros`, a worked `POST /admin/prices` request
  body, and the standing no-staleness-alert caveat (EdenAI price changes
  are never auto-detected, unlike OpenRouter's sync).
- **5.3**: new `tests/edenai-pricing-gate.test.mjs` (6 tests). Extends
  `tests/edenai-pricing.test.mjs`'s existing chat/tts coverage of
  `findMissingEdenAiPrices` to the four capabilities it didn't cover
  (translation/ocr/transcription/liveTranscription — each gates and
  clears correctly), a chat all-priced positive case, and an explicit
  assertion that `activate.js`'s `PRICE_OVERRIDE_REQUIRED` response body
  matches the gate function's real output.
- **5.4**: new `tests/edenai-secrets.test.mjs` (3 tests), with a scope
  correction from the task's original wording. The task asked to "mirror
  the equivalent OpenRouter test" — that test doesn't exist; no test in
  this suite invokes any `pages/api` route handler directly (confirmed by
  checking every file in `tests/`), and this route has no injectable seam
  for its collaborators (`getIntegration`/`getEdenAiCatalogue` import
  directly), so exercising it would mean introducing module-mocking infra
  used nowhere else in the suite, for one route. Instead tested
  `redactConfig` — the generic, provider-agnostic function both the GET
  and PUT handlers call as their last step before responding, shared by
  every provider integration (Vexa/Nextcloud/OpenRouter/EdenAI alike) —
  against a real `normalizeEdenAiConfig` output: confirms `apiKey` never
  appears in the redacted object (string-search included, not just
  key-absence) and `apiKeyConfigured` reports correctly in both states,
  plus that non-secret governance fields still pass through unredacted.
- **6.1**: `npm run lint` clean; `node --no-warnings --test tests/*.test.mjs`
  → 432 tests / 422 pass / 10 skipped (pre-existing, unrelated) / 0 failed.
- **6.4**: `openspec validate add-edenai-provider-foundation --strict` →
  valid.
- **6.2/6.3 — blocked at the time this entry was written**: both require
  exercising the app through a real org session against a live database,
  and 6.3 additionally needs a real EdenAI key, neither of which this
  session had access to yet without touching the user's own live
  `transkription-webapp`/`transkription-db` Docker containers (`:prod`
  tag, real data) — left unchecked rather than risk that. **Resolved
  2026-08-28**, later the same day, once the user provided a sandboxed
  key and asked for the Foundation remainder to be finished: verified
  both live against a separate, isolated, disposable Postgres + `next
  dev` instance (unique container name/port, torn down after — the
  user's real containers were never touched). See the "End-to-end live
  verification" entry further below for the full account.

## Live verification against a real EdenAI sandbox account (2026-08-28)

The user provided a sandboxed EdenAI dev key (`sk-eden-test-...`)
specifically to verify this change's assumptions — most of which were
previously sourced from EdenAI's own documentation (`edenai/docs`'
`v3/llms.txt`, `edenai-skill`, `edenai/cookbook`), never from a live
call. Used it for a focused round of real `curl` requests (never
committed anywhere; key held only in a local scratch file outside the
repo for the duration of the check). Findings, in order of impact:

1. **Both catalogue endpoint shapes this change previously called
   "confirmed" were wrong.** `GET /v3/models` really returns
   `{object:"list", data:[{id:"provider/model", capabilities:{...},
   pricing:{...}, ...}]}` (989 entries), not the grouped-by-provider
   shape `llms.txt` described. `GET /v3/info/{category}/{subfeature}?format=simplified`
   really returns `models` as an array of `{model, pricing, regions}`
   objects, not bare id strings. **Fixed**: `normalizeEdenAiChatModels`
   and `normalizeEdenAiUniversalModels` in `lib/edenai.js` rewritten to
   match; `tests/edenai.test.mjs`'s three catalogue-shape tests rewritten
   with real fixtures. This means every catalogue call this change has
   made so far (during Group 3 manual review, and implicitly by any admin
   who tried the panel) would have returned zero models — the previous
   "corrected" shape was never actually right.
2. **`tts`'s subfeature is `tts`, not `text_to_speech`.** Every source
   consulted, including `edenai/docs` itself, used the wrong longer name;
   `GET /v3/info/audio/text_to_speech` 400s with a real
   `available_subfeatures` list naming `tts`. **Fixed**:
   `EDENAI_CAPABILITY_MODEL_SHAPE.tts.subfeature`; this is a real bug
   that would have made TTS catalogue/activation calls fail with
   `EDENAI_CATALOGUE_FAILED` the first time anyone tried them.
3. **The chat-completions path ambiguity is resolved as moot — both
   `/v3/chat/completions` and `/v3/llm/chat/completions` are live,
   functional, real routes** (confirmed via negative controls: a bogus
   path 404s, a bogus model 400s, ruling out a catch-all). Switched
   `lib/edenai-probes.js`'s chat probe to the shorter path (matching 2 of
   3 original sources); no other call site used the old path yet.
4. **Live per-unit pricing data exists on both catalogue endpoints** —
   `/v3/models`'s `pricing.input_cost_per_token`/`output_cost_per_token`
   and `/v3/info/{cat}/{sub}`'s `models[].pricing.price`/
   `price_unit_quantity`/`price_unit_type` are both real, populated
   fields (e.g. `translation/automatic_translation/deepl`: $20 per
   million characters; `audio/speech_to_text_async/openai`: $0.006 per
   60 seconds). **This directly contradicts the premise the entire
   Manual Pricing Gate design rests on** ("EdenAI has no live
   pricing-rate catalogue"). **Not acted on** — this is a real
   architectural question (auto-derive prices the way
   `syncAllowedOpenRouterPrices` does for OpenRouter, vs. keep the
   manual gate deliberately as a safety check even with live rates
   available) that belongs to the user, not something to decide
   unilaterally mid-verification. The gate as built today is still
   correct and safe; only its stated justification needs revisiting.
   Flagged in design.md at both the point where it's described and in
   the catalogue section.
5. **Synchronous-call failures are HTTP 200, not an HTTP error status.**
   `/universal-ai` returns `{status:"fail", output:null,
   error:{message, provider_status_code}}` at HTTP 200 for a
   feature-level failure (verified with an unsupported spell-check
   language). `lib/edenai-probes.js`'s `probeEdenAiUniversal` already
   treated `!output` as failure before this was confirmed (a defensive
   check that happened to be correct), but its thrown error previously
   said only "returned no output" — improved to surface
   `result.error.message` when present (e.g. "Provider does not support
   selected language: `de`"), a real admin-facing improvement for
   activation troubleshooting. New test added.
6. **Async job creation/poll envelope confirmed**: `public_id` (not
   `job_id`) as the cookbook-sourced research already found, plus
   previously-unconfirmed fields `model: null` and `created_at`
   observed — neither consumed, no code change needed. Live-tested with
   a real async STT job (`status:"processing"` immediately after
   creation, still `"processing"` several seconds later — expected,
   since the input was a placeholder file URL, not real audio).
7. **TTS output confirmed**: `{audio: "<base64>", voice_type,
   audio_resource_url: "<signed, expiring CloudFront URL>"}` — both a
   base64 payload and a URL are present (this change's own design.md
   previously flagged "`audio_url` vs `audio_resource_url`" as an open
   inconsistency between docs and cookbook; resolved as
   `audio_resource_url`, plus a base64 alternative neither source
   mentioned). Not acted on in code — the TTS adapter doesn't exist yet
   (`migrate-chat-tts-and-decommission-openrouter`); noted in design.md
   for that change to pick up (prefer `audio` over the expiring URL).

**Important caveat, stated plainly**: this sandbox key returns a fixed
canned example for synchronous call *content* regardless of actual
input — the chat probe returned an unrelated pirate-themed image
description for a "Reply with the single word OK" prompt with no image
attached; spell-check always returned "Hollo, wrld! How r yu?" regardless
of the real input text or language requested. Routing, status codes,
error messages, and — critically — per-provider language-support
validation all behaved as real, server-enforced logic (see
`migrate-grammar-check-to-edenai`'s status.md for the German-language
finding this enabled). So: **wire-level contracts are now verified with
real confidence; real-world output quality on a production key remains
unverified**, and no claim to the contrary should be inferred from this
entry.

`node --no-warnings --test tests/*.test.mjs` — 433/423/10/0 after all
fixes. `npx eslint` clean.

## Pricing-architecture decision (2026-08-28)

Resolved the open question finding 4 raised: **keep the manual Pricing
Gate exactly as built; do not auto-derive prices from the now-confirmed
live catalogue pricing data.** Two independent reasons — see design.md's
"Activation And Pricing Gate" section for the full reasoning:

1. Even OpenRouter's own "live" sync (`syncAllowedOpenRouterPrices`/
   `normalizeCataloguePrice`) is hand-curated per capability, not a raw
   catalogue pass-through, and falls back to a manual price whenever its
   own derivation can't produce a confident rate. EdenAI's non-chat
   catalogue is more heterogeneous still — `price_unit_type` varies per
   *model* within one capability (TTS mixes `char` and `minute`; OCR
   includes `file`, which has no `PRICING_UNITS` equivalent), and every
   model publishes one `price`, not the separate input/output rates the
   schema requires. Auto-deriving this properly is real, scoped design
   work (chat would be the clean candidate later; the five universal-ai
   capabilities would need OpenRouter-grade per-capability mapping), not
   a quick toggle — out of scope for this change.
2. Requiring explicit admin review before a new provider's rate is
   trusted for cost/budget tracking is a reasonable safety practice on
   its own merits, independent of whether live data exists.

design.md's justification for the gate has been corrected accordingly
(the "no live pricing data" claim removed, replaced with the two reasons
above). No code changes from this decision — the gate, `activate.js`,
and `findMissingEdenAiPrices` are unaffected; only the *reason* the gate
exists was wrong, not the gate itself.

## End-to-end live verification (2026-08-28) — 6.2/6.3 closed

Ran the full activation flow against a real, isolated, disposable
Postgres + `next dev` instance (unique container name/port, never the
user's real running environment; torn down immediately after) using the
same sandboxed EdenAI key as the earlier API verification:

- Confirmed via `grep` that no production code path references the new
  router yet (6.2 — behavior can't differ from before this change since
  nothing calls it).
- Logged in, entered the EdenAI key, saved, fetched the live catalogue
  for all 6 capabilities (real API calls, all 200 OK, model lists
  matching the independently curl-verified data from the earlier
  session) — the admin panel rendered close to a thousand real chat
  models and the real per-capability lists for every other capability
  without incident.
- Allowlisted `audio/tts/deepgram/aura-2` for `tts`, attempted
  activation: correctly **blocked** with `PRICE_OVERRIDE_REQUIRED`
  naming all 4 missing `(edenai, audio/tts/deepgram/aura-2, <operation>)`
  pairs — the Pricing Gate (see the architecture decision above) working
  exactly as designed, on the very first real attempt.
- Created the 4 price rows via `POST /admin/prices` following task 4.3's
  own runbook — it worked exactly as documented, a good incidental
  cross-check of that documentation's accuracy.
- Retried activation: `{ok:true, capability:'tts', probed:true}` — a
  real live probe against real EdenAI ran and passed.
- Confirmed via the API and the UI: only `tts` is in
  `activatedCapabilities`, every other capability still shows "Nicht
  aktiviert", and OpenRouter's own integration config is completely
  unchanged (`enabled:false`, as it started) — activating one EdenAI
  capability never touches OpenRouter, exactly as designed (6.3).
- Also re-confirmed live the secret-redaction behavior from
  `tests/edenai-secrets.test.mjs`: the real GET response never contains
  `apiKey`, only `apiKeyConfigured:true`.

No code changes resulted from this pass — everything behaved exactly as
built and tested. Full test suite and lint still green (unchanged since
the last run: 433/423/10/0, lint clean).

## Outstanding

Nothing — every task in `tasks.md` is now complete
(`openspec validate add-edenai-provider-foundation --strict` passes).
This change is ready to be considered done; the pending flagged task
`task_cabaaebf` (unrelated OpenRouter bug, already fixed in a separate
session — see the "Verified" section above) and the two independent
pre-existing OpenSpec changes
(`add-openrouter-admin-console-ui-tests`/
`harden-openrouter-workload-test-coverage`) remain outside this change's
scope, as before.
- The pending flagged task `task_cabaaebf` ("Fix apiKey overwrite bug in
  resolveOpenRouterConfig") is independent of this change's remaining
  work and can be picked up separately at any time.
- Two known, documented gaps to close later, not blocking this change:
  the four capabilities without a live activation probe (see
  "Corrections" above), and the `/v3/models`/`/v3/info` response-envelope
  shape still needing verification against a real EdenAI account (from
  task 1.3).
- Land after `add-openrouter-admin-console-ui-tests` (already drafted),
  so `EdenAiIntegrationPanel.js`'s tests can reuse the jsdom/Testing
  Library setup that change introduces instead of re-adding it.
- The currently uncommitted post-implementation-fix diff to
  `consolidate-ai-providers-openrouter` (capability-aware chat parameters,
  context-bias forwarding, new audit events) should land first — this
  change's design assumes that diff as the working baseline.
- Remaining EdenAI endpoint/payload details (exact `/v3/info`/`/v3/models`
  response shapes, exact `universal-ai` per-feature `input` fields) still
  need verification against a live API key during implementation of
  later tasks — the base URL, auth, and top-level request/response
  contract are now confirmed, but per-feature field names are not yet
  exercised against a real account.
