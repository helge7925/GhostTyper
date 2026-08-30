# Design: Add EdenAI Provider Foundation

## Provider Routing

`lib/ai-provider-router.js` exports the single function every later
migration change calls instead of inventing its own routing logic:

```js
export async function resolveActiveProviderConfig({ userId, organizationId, capability }) {
  const edenai = await resolveEdenAiConfig({ userId, organizationId });
  if (
    edenai.enabled
    && edenai.activatedCapabilities?.includes(capability)
    && edenai.defaultModels[capability]
  ) {
    return { provider: 'edenai', ...edenai };
  }
  const openrouter = await resolveOpenRouterConfig({ userId, organizationId });
  return { provider: 'openrouter', ...openrouter };
}
```

**Corrected during Group 3 implementation**: an earlier draft of this
function checked only `enabled && defaultModels[capability]`. That is
unsafe for EdenAI's per-capability activation model specifically: unlike
OpenRouter's atomic all-5-capabilities-at-once activation (a single
`enabled` flag is a correct gate there), EdenAI activates one capability
at a time via `activate.js`'s probe/pricing checks. Once any one
capability had been activated, `enabled` becomes `true` for the whole
integration — after that, a plain `PUT` filling in a *different*
capability's `defaultModels` entry would make that capability live too,
with no probe or pricing check ever having run for it. `defaultModels`
is set by `PUT` (an ordinary config edit); `activatedCapabilities` is set
only by `activate.js` on a successful probe+pricing pass for that specific
capability, and the `edenai.js` route's `PUT` handler deliberately does
not accept it in the request body — it is the real per-capability gate,
`defaultModels` is just an editable proposal.

This reuses the existing per-capability `defaultModels` shape as the
activation signal — an org admin migrates one capability by activating it
(which requires a default model to already be set via `PUT`); they revert
by clearing that capability's default model, which makes it read as
unconfigured again with no separate "deactivate" step needed. No new
column beyond `activatedCapabilities` inside the existing JSON blob, no
new "active provider" flag anywhere. There is deliberately **no automatic
cross-provider fallback**: if the resolved provider's key/model turns out
unusable at call time, the operation fails closed with `MODEL_UNAVAILABLE`,
exactly like today's single-provider behavior — silently retrying against
the other provider would undermine the entire point of treating them as
having different data-handling postures (see Risks).

This change adds the router and wires it into the EdenAI activation flow
itself, but no existing workload call site is changed to use it yet — that
happens one capability at a time in each later migration change.

## EdenAI Client Module

`lib/edenai.js` mirrors `lib/openrouter.js` structurally without sharing
code (matching the existing precedent: Vexa and Nextcloud are already
separate per-provider modules alongside OpenRouter, not a shared abstract
"Integration" base class):

- `EDENAI_BASE_URL = 'https://api.edenai.run/v3'`
- `EDENAI_CAPABILITIES = ['chat', 'translation', 'ocr', 'transcription', 'liveTranscription', 'tts']`
  — six, not OpenRouter's five, because EdenAI exposes Translation as its
  own distinct product rather than an LLM chat-completion special case.
  These are GhostTyper's own capability names, distinct from (but mapped
  onto) EdenAI's own `category/feature` taxonomy — see "EdenAI API
  Surface" below for the mapping.
- `normalizeEdenAiConfig(config)` / `validateEdenAiGovernanceConfig(config)`
  — same shape as their OpenRouter counterparts: `apiKey`,
  `allowedModels`/`defaultModels` per capability, `activatedAt`. Reuses
  `normalizeModelId`/`MODEL_ID_PATTERN` from `lib/openrouter.js` as-is
  (EdenAI's `provider/model-id` and `category/feature/provider` strings
  already fit the existing pattern) rather than duplicating the
  validator.
- `getEdenAiCatalogue(...)` — see "Live EdenAI Catalogue" below.
- `resolveConfiguredEdenAiModel(config, capability, requestedModel)` —
  mirrors `resolveConfiguredModel`: requested-if-allowlisted, else
  default-if-allowlisted, else throws `MODEL_UNAVAILABLE`.
- `edenAiJsonRequest(path, body, apiKey, opts)` / `edenAiHeaders(apiKey)` —
  mirrors `openRouterJsonRequest`/`openRouterHeaders`. EdenAI has no
  confirmed per-request ZDR/`data_collection` flag equivalent to
  OpenRouter's — this module does not fabricate one (see Risks).
- `submitEdenAiAsyncJob(body, apiKey)` /
  `pollEdenAiAsyncJob(jobId, apiKey, {intervalMs, timeoutMs})` — thin
  wrappers around `POST /v3/universal-ai/async` and
  `GET /v3/universal-ai/async/{job_id}`, the async-job primitive later
  phases' transcription adapters build on (EdenAI's STT product is
  submit-a-job-then-poll, not synchronous — see "EdenAI API Surface").

`lib/edenai-service.js` is created as an otherwise-empty scaffold in this
change. It is the mirror of `lib/ai-service.js` and grows one exported
function per later migration change (`translateTextEdenAi` in the
Translation change, `transcribeAudioEdenAi` in the Batch-STT change, and so
on), each returning exactly the shape its OpenRouter counterpart returns so
call sites only need to change which function they call, not how they use
the result.

## EdenAI API Surface (v3, Confirmed Live Against A Real Account, 2026-08-28)

EdenAI's current AI-facing API is v3 (v2 is legacy, retained only for
account-level cost/token endpoints through end of 2026 — never used for
AI calls). Base URL: `https://api.edenai.run/v3`. Two distinct model-id
shapes:

- **Chat**: `POST /v3/chat/completions`, OpenAI-compatible, `model` is a
  `provider/model-id` string (e.g. `anthropic/claude-opus-4-7`,
  `openai/gpt-4o`). Supports `response_format` with a JSON schema,
  streaming, tool calling, vision content blocks — the standard OpenAI
  request shape. **Both this path and `/v3/llm/chat/completions` are
  confirmed live and functional** (verified with a real bogus-path 404
  and a real bogus-model 400 as negative controls, ruling out a
  catch-all) — the earlier "which one is correct" ambiguity between
  `edenai/docs`/`edenai-skill` (favoring the shorter path) and three
  `edenai/cookbook` notebooks (using the `/llm/` variant) is resolved as
  moot: both work. Code now uses the shorter path, matching two of the
  three original sources; the response envelope for both is identical
  (`{status, id, created, model, object, choices, usage, cost, provider}`,
  i.e. OpenAI's shape plus EdenAI's `status`/`cost`/`provider` fields).
- **Everything else** (translation, OCR, spell-check, transcription,
  TTS): `POST /v3/universal-ai` (synchronous) or
  `POST /v3/universal-ai/async` (any subfeature whose name ends `_async`,
  notably `audio/speech_to_text_async`), `model` is a
  `category/subfeature/provider` string (e.g.
  `translation/automatic_translation/deepl`,
  `audio/speech_to_text_async/openai`, `audio/tts/openai/tts-1`,
  `text/spell_check/sapling`). Response envelope, confirmed live:
  `{status: "success"|"fail", cost: "<string decimal>", provider,
  feature, subfeature, output: {...}|null, error: {message,
  provider_status_code}|null, original_response: null}` — **a
  feature-level failure (e.g. an unsupported language) is HTTP 200 with
  `status:"fail"`/`output:null`/a real `error.message`, not an HTTP
  error** (`lib/edenai-probes.js`'s universal-ai probe already treated
  `!output` as failure before this was confirmed, which happened to be
  correct; it now also surfaces `error.message` in the thrown error
  instead of a generic one). Async calls return `{..., public_id:
  "<uuid>", model: null, created_at}` (HTTP 202, confirmed exact field
  name, not `job_id`); poll `GET /v3/universal-ai/async/{job_id}` for the
  same envelope with `output` populated once `status` becomes `success`.
  `universal-ai` also accepts an optional `fallbacks` array (per
  `edenai/docs`, not independently verified live) — a possible future
  reliability enhancement, not used by the initial adapters, kept
  separate from GhostTyper's own EdenAI-vs-OpenRouter routing decision
  (which stays fail-closed, never silently substituting providers).
- **tts's subfeature is `tts`, not `text_to_speech`** — every prior
  source (including `edenai/docs`) used the longer, wrong name;
  `GET /v3/info/audio/text_to_speech` 400s with
  `{"available_subfeatures":["tts","speech_to_text_async"]}`.
  `EDENAI_CAPABILITY_MODEL_SHAPE.tts.subfeature` is now `'tts'`. TTS's
  confirmed live output shape is `{audio: "<base64>", voice_type,
  audio_resource_url: "<signed, expiring URL>"}` — both a base64 payload
  and a URL are present; the not-yet-built TTS adapter
  (`migrate-chat-tts-and-decommission-openrouter`) should prefer `audio`
  (base64) over `audio_resource_url` to avoid a signed-URL-expiry race,
  a decision that change's own design.md should make explicitly, not
  assumed here.

**Important caveat about this verification**: it used a sandboxed test
API key (`sk-eden-test-...`) the user provided specifically to verify
this change's assumptions. Endpoint routing, status codes, error
messages, and language-support validation all behaved as real,
server-enforced logic (confirmed via negative controls: bogus paths
404, bogus models 400, an unsupported language for one spell-check
provider correctly fails while another succeeds — see
`migrate-grammar-check-to-edenai`'s status.md). But *synchronous* call
**content** (chat replies, spell-check corrections, TTS audio) was a
fixed canned fixture regardless of actual input — the chat probe
returned an unrelated pirate-themed image description for a
"Reply with OK" prompt, and spell-check always returned "Hollo, wrld!
How r yu?" regardless of the input text. This confirms wire-level
*contracts* (shapes, field names, status codes, envelopes) precisely,
but says nothing about real output *quality* on a production key — that
remains unverified and out of scope for what a sandbox key can prove.

## Live EdenAI Catalogue (Confirmed Live Against A Real Account, 2026-08-28)

An earlier draft of this design assumed EdenAI exposes no live
per-model/per-provider catalogue and therefore needed a static,
source-controlled `EDENAI_PROVIDER_REGISTRY`. This was wrong: EdenAI
publishes authoritative live catalogue endpoints.

**Corrected a second time (2026-08-28), against a real request against a
real account — the `edenai/docs`' `v3/llms.txt` reference this design
previously trusted as "confirmed" turned out to describe neither
endpoint's real shape correctly**:

- **Chat**: `GET /v3/models` returns
  `{object: "list", data: [{id: "provider/model-name", object: "model",
  created, owned_by, model_name, context_length, description,
  capabilities: {supports_response_schema, supports_function_calling,
  supports_vision, ...many more per-model flags}, pricing: {
  input_cost_per_token, output_cost_per_token, cache_read_input_token_cost,
  cache_creation_input_token_cost, ...}, list_pricing, discount, regions,
  alias_of}, ...]}` — 989 entries observed on the test account. `id` is
  **already** the fully composed `provider/model-id` string; no
  provider+name composition is needed (the `llms.txt`-sourced
  grouped-by-provider shape this design previously described does not
  match reality). `capabilities.supports_response_schema`/
  `supports_function_calling` genuinely exist (an earlier draft added
  speculative versions of these fields to the catalogue normalizer, then
  removed them as unconfirmed — they were real all along, just nested
  under `capabilities` rather than top-level; still not surfaced by
  `getEdenAiCatalogue` since nothing consumes them yet).
- **Every other capability**: `GET /v3/info/{category}/{subfeature}?format=simplified`
  returns `{feature, feature_fullname, subfeature, subfeature_fullname,
  description, mode: "sync"|"async", endpoints: {create, get?, list?,
  delete?}, input_schema: {fields: [...]}, output_schema: {fields: [...]},
  models: [{model: "category/subfeature/provider", pricing: {price,
  price_unit_quantity, price_unit_type}, regions: [{code, name}]}, ...]}`.
  `models` is an array of **objects**, not bare id strings as this design
  previously described (also `llms.txt`-sourced, also wrong) — the
  composed id is at `.model`. The flat `GET /v3/info` (no path suffix)
  genuinely does only return feature names per category, as the first
  correction below found; that part held up.
- **Both endpoints carry a genuine live per-unit `pricing` block per
  model.** This contradicted the "EdenAI has no live pricing-rate
  catalogue" premise the manual Pricing Gate's original justification
  rested on — **decided (2026-08-28): the gate itself stays exactly as
  built; only its justification is corrected**, see "Activation And
  Pricing Gate" below for the two independent reasons (unit
  heterogeneity, deliberate admin review) that hold regardless of data
  availability.

`getEdenAiCatalogue({apiKey, organizationId, capability, allowStale, force})`
mirrors `getOpenRouterCatalogue`'s shape and caching strategy (10-minute
fresh / 24-hour stale in-memory cache, keyed per organization-or-operator
and key fingerprint) instead of reading a static array: one request per
capability (`/models` for `chat`, `/info/{category}/{subfeature}` for the
other five), normalized into GhostTyper's internal model shape, returning
`{models, fetchedAt, stale}` — the same contract `pages/api/models.js`
and the admin panel already consume for OpenRouter, via the route's new
`provider` query parameter. The normalizer discards the
`pricing`/`capabilities`/`regions` fields both endpoints carry, keeping
only `{id, name}` — deliberately: the pricing-architecture decision
above settled on the manual gate, not auto-derivation from these fields,
so nothing needs to read more than `{id, name}` today.

This removes the "static registry maintenance burden" risk from the
original design entirely — a new EdenAI model or provider becomes
selectable the moment EdenAI publishes it, exactly like OpenRouter, with
no code change or redeploy required. The `model-governance` capability's
"Dynamic Catalogue" requirement did not need to be narrowed for EdenAI
after all; it only needed its wording generalized away from naming
OpenRouter specifically, since EdenAI now qualifies as a second
live-catalogue provider under the same requirement.

## Activation And Pricing Gate

`pages/api/organizations/integrations/edenai/activate.js` differs from
`openrouter/activate.js` in one important way: OpenRouter's activation is
all-or-nothing (probes all five capabilities atomically, and in the same
transaction disables the previous provider). EdenAI's activation is
**per-capability** — the request body names one capability, only that
capability's proposed default is probed (`probeEdenAiCapability`, mirrors
`probeOpenRouterDefaults` but scoped to one capability instead of five),
and OpenRouter is never disabled by this route. Multiple capabilities are
activated by calling this route multiple times, once per capability, as
each later migration change is ready for it.

Before probing, activation resolves the capability's EdenAI `OPERATIONS`
mapping (a new, small, EdenAI-only map living next to
`lib/openrouter-pricing.js`'s existing `OPERATIONS` const — not merged into
it, since the two providers' operation-to-capability shapes differ) and
calls `resolveProviderPrice({provider:'edenai', model, operation})` for
each entry. Any `PricingConfigurationError` is surfaced as
`PRICE_OVERRIDE_REQUIRED` naming the exact missing `(model, operation)`
pairs — the admin creates them via the already-generic `/admin/prices` UI
(no new pricing UI needed) before retrying activation.

This gate was originally justified as "EdenAI has no live per-unit
pricing-rate catalogue, only a post-call `cost` field." **That
justification is factually wrong** — live verification (2026-08-28)
found both catalogue endpoints do carry a real per-unit `pricing` block
per model (`/v3/models`'s `data[].pricing.input_cost_per_token`/
`output_cost_per_token`; `/v3/info/{cat}/{sub}`'s
`models[].pricing.price`/`price_unit_quantity`/`price_unit_type`) — see
"Live EdenAI Catalogue" above and status.md's 2026-08-28 entry. The gate
itself stays exactly as built; only the reason changes:

**Decided (2026-08-28)**: keep the manual gate, do not auto-derive
prices from the live catalogue data. Two independent reasons, not one:

1. **Unit heterogeneity makes automatic derivation genuinely hard, not
   just undesirable.** Even OpenRouter's own "live" sync
   (`syncAllowedOpenRouterPrices`/`normalizeCataloguePrice` in
   `lib/openrouter-pricing-core.js`) is not a raw pass-through of
   catalogue data — it is hand-curated, capability-specific logic
   (including a flat `+ 0.002` token-cost estimate hardcoded into its
   OCR branch, clearly tuned from real usage, not derived from the
   catalogue) with an explicit manual-override fallback whenever
   derivation fails for a given model. EdenAI's non-chat catalogue is
   *more* heterogeneous than OpenRouter's: `price_unit_type` varies
   *per model within the same capability* (TTS mixes `char`-priced
   providers with Google's `minute`-priced Gemini models; OCR mixes
   `page`/`request`/`file` — `file` has no equivalent in
   `lib/pricing-core.js`'s `PRICING_UNITS` enum at all), and every
   EdenAI universal-ai model publishes one `price`, not the separate
   input/output rates `provider_price_versions` requires — every
   capability would need its own conversion policy, mirroring (and
   likely exceeding) `normalizeCataloguePrice`'s complexity. This is
   real, scoped design-and-build work, not a quick auto-sync toggle.
2. **Requiring explicit admin review before a new provider's rate is
   trusted for cost/budget tracking is a reasonable safety practice on
   its own merits, independent of whether live data exists** — the same
   posture OpenRouter's own sync falls back to whenever its
   normalization can't produce a confident rate. A newly-appearing
   catalogue entry becoming spendable the moment EdenAI publishes it,
   with no human ever having looked at the number, is not obviously the
   right default for an app that tracks real organizational budgets.

Auto-deriving EdenAI prices from the live catalogue (chat is the
cleanest candidate — clean per-token rates, structurally identical to
OpenRouter's own chat handling; the five universal-ai capabilities would
need OpenRouter-grade hand-curated per-capability mapping) remains a
legitimate future enhancement if the manual runbook's operational toil
becomes a real problem — but it is out of scope for this change, and
should get its own design pass rather than being bolted on here. Budget
*reservation* happens before the call and therefore still needs a
pre-known rate, which stays a manually entered admin override — a
one-time gate per capability activation, not a continuous sync. Budget
*commit*, by contrast, can prefer EdenAI's actual reported `cost` per
call the same way `calculateUsageCost()` already prefers OpenRouter's
reported `usage.cost` when present — no change needed there. EdenAI price
changes upstream still require the admin to notice and re-enter the
reservation-time rate manually (documented as an operational runbook
item, not solved by this change).

## Manual Pricing-Entry Runbook

Who does this, and when: the **platform admin** (not an org admin —
`/admin/prices` is gated by `requireAdmin`, a platform-level role,
distinct from the `meeting.admin` org permission that gates the EdenAI
integration panel itself). This must happen **before** an org admin's
first activation attempt for a given capability, or `activate.js` returns
`PRICE_OVERRIDE_REQUIRED` and blocks it.

**Step 1 — find the exact `(model, operation)` pairs needed.** For the
capability about to be activated, look up its EdenAI `OPERATIONS` list in
`lib/edenai-pricing.js`'s `EDENAI_OPERATIONS`, and the capability's
proposed default model in the org's EdenAI integration config
(`defaultModels.<capability>`, visible in `EdenAiIntegrationPanel.js`).
One price row is required per operation in that list, all for the same
model. Example: activating `chat` with default model
`anthropic/claude-opus-4-7` requires four rows, one each for `analysis`,
`text_optimization`, `template_generation`, `knowledge_prep` — all with
`provider: 'edenai'`, `model: 'anthropic/claude-opus-4-7'`.

**Step 2 — get the real per-unit rate from EdenAI.** EdenAI's API does
not publish a rate-per-unit catalogue (see "Activation And Pricing Gate"
above) — the admin must look up the current rate for that
`provider/model` on EdenAI's own pricing page or account dashboard, then
convert it to whole-number micros per million units
(`round(rate_usd_per_unit * 1_000_000 * 1_000_000)`) to fit
`provider_price_versions`' integer `*_price_per_million_micros` columns.

**Step 3 — create the row via `POST /admin/prices`** (or the
`/admin/prices` UI form), one call per `(model, operation)` pair:

```json
{
  "provider": "edenai",
  "model": "anthropic/claude-opus-4-7",
  "operation": "analysis",
  "inputUnit": "token",
  "outputUnit": "token",
  "inputPricePerMillionMicros": 15000000,
  "outputPricePerMillionMicros": 75000000,
  "effectiveFrom": "2026-08-28T00:00:00.000Z",
  "reason": "EdenAI chat activation for capability=chat"
}
```

`inputUnit`/`outputUnit` must be one of `PRICING_UNITS`
(`token`, `audio_second`, `character`, `page`, `request` —
`lib/pricing-core.js`) and should match what the capability actually
bills by, not always `token`: `ocr`/`translation`/`transcription` likely
bill by `page`/`character`/`audio_second` once each migration phase
confirms EdenAI's actual billing unit for its chosen provider — this is
each phase's own task, not assumed here. `cachedInputPricePerMillionMicros`/
`cacheWritePricePerMillionMicros` are optional (`nullable`) and can be
omitted unless the specific EdenAI provider bills for caching.
`effectiveFrom` starts the row's validity; a later rate change is a new
row with a later `effectiveFrom`, never an edit to an existing one
(`provider_price_versions` rows are immutable once created — see
`createPriceVersion`'s overlap-closing logic in `lib/pricing-service.js`).

**Step 4 — retry activation.** `findMissingEdenAiPrices` re-checks all
pairs and only then lets the probe/catalogue steps in `activate.js` run.

**Ongoing**: EdenAI price changes upstream are not detected automatically
(no live rate sync, unlike OpenRouter's `syncAllowedOpenRouterPrices`) —
the platform admin must periodically re-check EdenAI's published rates
per activated `(provider, model)` pair and create a new price row when
they change. No staleness alert exists for this yet; flagged as a
standing operational task, not a gap this change closes.

## Admin Console

`components/settings/EdenAiIntegrationPanel.js` mirrors
`OpenRouterIntegrationPanel.js`'s layout and behavior closely, including
its "fetch live catalogue" step — now that EdenAI's own catalogue is live
(`getEdenAiCatalogue`), the panel can reuse the same
loop-over-capabilities-and-call-`/api/models`-per-capability pattern the
OpenRouter panel already uses, rather than the static-list-only UI
originally planned. It renders next to
the existing panels on `pages/settings/organization/integrations.js`,
gated on the same `meeting.admin` permission. It ships in this change with
every capability's allowlist empty — a functional but inert panel, letting
an admin add and validate an EdenAI key ahead of any workload migration
with zero behavior change.

## What This Phase Does Not Do

- No workload call site changes provider. Every `executeReservedSpend`
  call in the codebase still resolves and passes `provider: 'openrouter'`
  exactly as it does today.
- No native diarization, custom vocabulary, DeepL glossary, or other
  EdenAI-specific quality feature is adopted here — this change is
  infrastructure only.
- OpenRouter is never disabled or removed by this change.

## Risks / Trade-offs

- **Model/feature-string mapping complexity**: EdenAI's two different
  model-string shapes (`provider/model-id` for chat vs.
  `category/feature/provider` for everything else, see "EdenAI API
  Surface") mean `normalizeEdenAiConfig`/`resolveConfiguredEdenAiModel`
  must know which shape applies per capability, unlike OpenRouter's
  single flat model-id convention across all five of its capabilities —
  a genuine, if modest, extra piece of provider-specific logic in
  `lib/edenai.js` that has no OpenRouter analogue.
- **No live pricing-rate catalogue**: EdenAI's live catalogue confirms
  model/provider *availability*, not per-unit *price*, so the manual
  pricing gate (above) is still needed for reservation-time cost
  estimates even though model discovery itself is now live.
- **No per-request ZDR-equivalent flag**: `edenAiJsonRequest` does not send
  a privacy flag the way `openRouterJsonRequest` always sends
  `provider:{zdr:true, data_collection:'deny'}`, because no confirmed
  EdenAI equivalent exists. EdenAI's stated default data handling ("not
  retained by default, removed within 24 hours") is a materially weaker,
  time-bounded guarantee than OpenRouter's per-request zero-retention
  flag plus catalogue-level ZDR-only-model filtering. This gap is not
  resolved by this change — before any later migration change routes real
  customer content through EdenAI, the product owner must independently
  verify EdenAI's DPA terms against whatever bar OpenRouter's ZDR
  requirement was chosen to meet.
- **Per-capability activation, not atomic**: unlike OpenRouter's
  all-or-nothing activation, an org can end up with some capabilities on
  EdenAI and others on OpenRouter indefinitely (this is the intended,
  gradual migration state, not a bug) — admin UI copy should make this
  mixed state legible rather than implying a single "provider" toggle.
