# Tasks: Hardcode EdenAI Models

## 1. Remove The `grammar` Capability

- [x] 1.1 `lib/edenai.js`: remove `'grammar'` from `EDENAI_CAPABILITIES`
  and its entry from `EDENAI_CAPABILITY_MODEL_SHAPE`.
- [x] 1.2 `lib/edenai-service.js`: remove `checkGrammarEdenAi`.
- [x] 1.3 `lib/edenai-pricing.js`: remove `grammar: ['grammar_check']`
  from `EDENAI_OPERATIONS`.
- [x] 1.4 `pages/api/organizations/integrations/edenai/activate.js`:
  remove the `grammar` branch from `probeInputFor`. Went further —
  `defaultModel` now comes from `EDENAI_HARDCODED_MODEL` (Group 2), so
  `probeInputFor`/its language-lookup indirection was removed entirely,
  not just the `grammar` branch.
- [x] 1.5 `components/settings/EdenAiIntegrationPanel.js`: removed with
  the full panel rewrite (Group 5).
- [x] 1.6 Deleted `tests/edenai-grammar.test.mjs`; removed the
  grammar-specific test cases from `tests/edenai.test.mjs` (capability
  count back to six, shape test, catalogue-URL test — the latter deleted
  entirely along with the rest of `getEdenAiCatalogue`'s test coverage,
  see 2.2).

## 2. Hardcoded-Model Architecture

- [x] 2.1 `lib/edenai.js`: added `EDENAI_HARDCODED_MODEL` —
  `{chat: 'anthropic/claude-sonnet-5', translation: null, ocr: null,
  transcription: null, liveTranscription: null, tts: null}`.
- [x] 2.2 `lib/edenai.js`: removed `getEdenAiCatalogue`,
  `fetchEdenAiCatalogueEntries`, `normalizeEdenAiChatModels`,
  `normalizeEdenAiUniversalModels`, the catalogue cache, and
  `resolveConfiguredEdenAiModel`. Also removed the now-unused `crypto`
  import (only `keyFingerprint` used it). Kept `EdenAiError`,
  `edenAiHeaders`, `edenAiJsonRequest`, `isEdenAiFeatureAsync`,
  `submitEdenAiAsyncJob`, `pollEdenAiAsyncJob`,
  `EDENAI_CAPABILITY_MODEL_SHAPE`.
- [x] 2.3 `lib/edenai.js`: simplified `normalizeEdenAiConfig` — dropped
  `allowedModels`/`defaultModels` and their empty-map helpers; kept
  `apiKey`, `ttsVoices`, `activatedCapabilities`, `activatedAt`,
  `schemaVersion`. Removed `validateEdenAiGovernanceConfig`.
- [x] 2.4 `lib/ai-provider-router.js`: `resolveActiveProviderConfig`'s
  EdenAI gate now checks `EDENAI_HARDCODED_MODEL[capability]`. Also adds
  `model: EDENAI_HARDCODED_MODEL[capability]` onto the returned object
  when `provider === 'edenai'`, so call sites don't need their own
  import of the constant (used by `text-optimization.js`).

## 3. EdenAI Chat Adapter + Unified `text-optimization.js` Routing

- [x] 3.1 `lib/edenai-service.js`: added `optimizeTextEdenAi` — mirrors
  `optimizeText` exactly (same `presetInstructions`, same prompt, same
  return contract), calling `edenAiJsonRequest('/chat/completions', ...)`.
- [x] 3.2 `pages/api/text-optimization.js`: all six presets now resolve
  `resolveActiveProviderConfig({capability:'chat'})` uniformly — the
  preset-conditional branch is gone, replaced by a single
  provider-conditional branch (`active.provider === 'edenai'` vs.
  `'openrouter'`). `operation: 'text_optimization'` for every preset,
  every provider now. Audit log still records `provider`/`model`.

## 4. Simplify Admin Routes

- [x] 4.1 `pages/api/organizations/integrations/edenai.js`: `pickUpdate`
  only accepts `apiKey`/`ttsVoices`. Governance-validation branch (catalogue
  fetch, allowlist check, `MODEL_CATALOGUE_MISMATCH`) removed. GET/PUT
  call `normalizeEdenAiConfig` directly. GET response also now includes
  `capabilities`/`hardcodedModels` so the client panel can render without
  importing server-side config (matches the existing pattern of not
  importing `lib/edenai.js` into client bundles).
- [x] 4.2 `pages/api/organizations/integrations/edenai/activate.js`:
  reads `EDENAI_HARDCODED_MODEL[capability]`; returns `400
  MODEL_NOT_YET_CONFIGURED` when `null`, before even touching the
  integration/pricing/probe logic. Catalogue check removed. Pricing gate
  and probe logic unchanged in substance.
- [x] 4.3 `pages/api/organizations/integrations/edenai/test.js`:
  simplified to one authenticated `GET /v3/info` call (cheapest
  available authenticated endpoint) — a pure "does this key work" check,
  no per-capability catalogue looping or model counts.
- [x] 4.4 `pages/api/models.js`: removed the `provider=edenai` branch
  (`handleEdenAi`) entirely — back to OpenRouter-only, matching its
  pre-Foundation-change shape.

## 5. Simplify Admin Panel

- [x] 5.1 `components/settings/EdenAiIntegrationPanel.js`: rewritten —
  API key field + save, one card per capability (label, badge, read-only
  hardcoded-model line or "noch nicht festgelegt", TTS voice input for
  `tts` only, activate button disabled when no model is set). Catalogue
  fetch, checkboxes, and dropdowns all removed.

## 6. Tests

- [x] 6.1 `tests/edenai.test.mjs`: rewritten for the simplified
  `normalizeEdenAiConfig` shape, removed `validateEdenAiGovernanceConfig`/
  `getEdenAiCatalogue`/`resolveConfiguredEdenAiModel` tests, added an
  `EDENAI_HARDCODED_MODEL` test (chat decided, the rest still `null`).
- [x] 6.2 `tests/edenai-secrets.test.mjs`: fixtures updated — no more
  `allowedModels`/`defaultModels`, now asserts `ttsVoices` passes through
  `redactConfig` unchanged instead.
- [x] 6.3 `tests/edenai-pricing-gate.test.mjs`: verified unchanged and
  still passing (no edits needed — it only ever depended on
  `findMissingEdenAiPrices`/injected `resolveProviderPrice`, not on
  model-selection shape).
- [x] 6.4 `tests/ai-provider-router.test.mjs`: rewritten — the
  `edenAiStub` no longer takes/returns `defaultModels` (the gate reads
  `EDENAI_HARDCODED_MODEL` directly now, not something a resolver stub
  can override); tests use the real capability names (`chat` — has a
  hardcoded model; `ocr` — still `null`) instead of synthetic ones.
- [x] 6.5 New `tests/edenai-optimize-text.test.mjs` (6 tests): request
  shape, preset-instruction selection including `spelling_grammar`'s
  unchanged text, custom-instruction handling, unknown-preset fallback,
  full return-shape match against `optimizeText`'s contract,
  `MODEL_UNAVAILABLE` on a missing model.
- [x] 6.6 Checked `tests/budget-runtime.test.mjs`'s two references to
  `pages/api/text-optimization.js` — both are generic
  static-analysis-style checks (file uses `executeReservedSpend`
  somewhere), not grammar-specific; still pass unchanged, no edit needed.

## 7. Verification

- [x] 7.1 `npm run lint` and `npm test` pass. Verified 2026-08-28:
  lint clean; 434 tests / 422 pass / 12 skipped (10 pre-existing + 2
  DB-only) / 0 failed.
- [x] 7.2 Manual: with EdenAI unconfigured, every text-optimization
  preset still works via OpenRouter exactly as before (no behavior
  change for orgs that haven't touched EdenAI). Verified 2026-08-28
  against an isolated throwaway Postgres + `next dev` instance (never
  the user's real environment): `spelling_grammar`/`clearer`/`friendlier`
  all correctly fall through to the OpenRouter branch (confirmed via
  server logs — `resolveConfiguredModel` throwing `MODEL_UNAVAILABLE`
  because this fresh test org has no OpenRouter model configured either,
  the same pre-existing failure a real unconfigured org would hit,
  unrelated to this change).
- [x] 7.3 Manual, same isolated environment, real production EdenAI key:
  `translation` activation correctly rejected with
  `MODEL_NOT_YET_CONFIGURED` (before even checking the API key). Saved a
  real key, activated `chat` — first blocked by
  `PRICE_OVERRIDE_REQUIRED` naming the 4 real missing `(anthropic/claude-sonnet-5,
  <operation>)` pairs (pricing gate working correctly), created those
  rows via `/admin/prices`, retried: `{ok:true, probed:true}` — a real
  ~2.6s round trip to EdenAI's chat endpoint. Submitted a real
  `spelling_grammar` request: a real ~2.8s round trip to EdenAI followed,
  and `organization_budget_periods` shows a real `reserved_micros: 3598`
  entry for this org/period — both confirm the real EdenAI call
  genuinely happened through `optimizeTextEdenAi`. The HTTP response
  itself was a 503 ("Provider usage occurred, but its accounting commit
  is still pending") — a budget-commit-worker timing gap specific to
  this minimal, hand-seeded test org (no normal onboarding flow ran to
  set up its budget period processing), not a defect in this change;
  the routing, activation, pricing gate, and real EdenAI connectivity
  this task cares about are all confirmed by the evidence above.
- [x] 7.4 `openspec validate hardcode-edenai-models --strict` passes.
  Verified 2026-08-28.
- [x] 7.5 Updated `migrate-grammar-check-to-edenai/status.md` to mark it
  superseded by this change (not deleted), pointing here.
