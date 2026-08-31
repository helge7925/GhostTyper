# Tasks: Migrate Translation To EdenAI

## 1. EdenAI Translation Adapter

- [x] 1.1 `lib/edenai-service.js`: `translateTextEdenAi(text, targetLanguage,
  sourceLanguage, apiKey, model, options)` returning
  `{translatedText, usage, model, providerRequestId}`.
- [x] 1.2 `lib/edenai-service.js`: `translateTextSegmentsEdenAi(segments,
  targetLanguage, sourceLanguage, apiKey, model, options)` returning
  `{translations, usage, model, providerRequestId}`, same length-
  preservation contract as `translateTextSegments`.
- [x] 1.3 `lib/edenai-pricing.js`'s `EDENAI_OPERATIONS.chat`: add
  `translation`, `office_translation`, `live_translation` (moved from the
  removed `EDENAI_OPERATIONS.translation`).
- [x] 1.4 `lib/edenai.js`: remove the `translation` entry from
  `EDENAI_CAPABILITIES`, `EDENAI_CAPABILITY_MODEL_SHAPE`, and
  `EDENAI_HARDCODED_MODEL` — translation has no capability of its own,
  see design.md's live-evidence table.

## 2. Call Sites

- [x] 2.1 `pages/api/translate.js`: replace the hardcoded
  `provider:'openrouter'` in the `translate` closure with
  `resolveActiveProviderConfig({capability:'chat'})`, branch to
  `translateText`/`translateTextEdenAi`.
- [x] 2.2 `pages/api/translate/file.js`'s `translateSegmentsWithGlossary()`:
  same router call (capability `chat`), branch to `translateTextSegments`/
  `translateTextSegmentsEdenAi`; update all three call sites (office,
  PDF-in-place, PDF-OCR-fallback) to pass `provider`/`apiKey` from the
  resolved config. OCR's own OpenRouter resolution (scanned-PDF fallback)
  stays untouched.
- [x] 2.3 Confirm `lib/vexa-bridge.js` is untouched by this change (its
  two `provider:'openrouter'` sites remain, deferred by design).
- [x] 2.4 `components/settings/EdenAiIntegrationPanel.js`: remove the
  `translation` label entry (the panel is capability-array-driven, so no
  other change is needed — dropping it from `EDENAI_CAPABILITIES` already
  removes the card).

## 3. Pricing

- [x] 3.1 No new admin runbook step: translation-shaped operations now
  live under `chat`'s existing `EDENAI_OPERATIONS` entry, so activating
  `chat` (already documented in `hardcode-edenai-models`) is the only
  pricing gate — no separate `(edenai, mistral-small-latest, translation)`
  runbook entry beyond what `chat` activation already required.

## 4. Tests

- [x] 4.1 `tests/edenai-translation.test.mjs`: mocked-fetch contract test
  for `translateTextEdenAi`/`translateTextSegmentsEdenAi`, mirroring
  `tests/edenai-optimize-text.test.mjs`'s pattern (11 tests: request
  shape, glossary block/strict-placeholder instruction, return contract,
  MODEL_UNAVAILABLE, empty-segments short-circuit, shape-mismatch on bad
  JSON/wrong length).
- [x] 4.2 `tests/edenai.test.mjs`/`tests/edenai-pricing.test.mjs`/
  `tests/edenai-pricing-gate.test.mjs`: updated for the five-capability
  list and the `chat`-owns-translation-operations pricing shape.
- [x] 4.3 The glossary-guard tests (`tests/translation-glossary.test.mjs`)
  needed no changes — they already exercise the guard against an
  injected mock `translate` callback, provider-agnostic by construction.

## 5. Verification

- [x] 5.1 Live production-key comparison (2026-08-28): dedicated
  `translation/automatic_translation` (deepl/google/amazon/microsoft/
  modernmt) vs. `chat`/`mistral-small-latest`, schema check + two rounds
  of stress testing (placeholder preservation, markdown, idiom,
  register). Full evidence in design.md. Result: `chat` wins outright,
  no dedicated adapter built.
- [x] 5.2 `npm run lint` and `npm test` pass (445 tests / 433 pass / 12
  skipped / 0 failed).
- [x] 5.3 `openspec validate migrate-translation-to-edenai --strict`
  passes.
- [x] 5.4 Live-called the actual shipped `translateTextEdenAi`/
  `translateTextSegmentsEdenAi` (imported directly from
  `lib/edenai-service.js`, not reimplemented) against production EdenAI
  with `mistral/mistral-small-latest`: single-text translation with a
  glossary block preserved both `DNTX...XTDN`/`TRMX...XMRT` placeholders
  verbatim; 3-segment JSON-array translation returned the exact segment
  count, correctly ordered, placeholder preserved. Confirms the shipped
  code (not just the earlier hand-typed curl payloads in design.md) is
  correct. Key deleted from scratchpad immediately after, verified no
  leak via repo-wide grep.
- [ ] 5.5 Manual: activate EdenAI for `chat` on a full seeded workspace
  (DB + `next dev` + browser) and submit an inline translation, an
  office-document translation, and a PDF translation through the actual
  UI, confirming `usage_log` records `provider='edenai'` and the layout
  report / QA diff output is unchanged. Not yet run — 5.4 verified the
  EdenAI call itself is correct; this task is the remaining DB/routing/UI
  wiring check, same isolated-environment pattern as
  `hardcode-edenai-models`'s manual checks. Deferred, not forgotten.
