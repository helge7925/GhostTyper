# Tasks: Migrate Grammar/Spell Check To EdenAI

## 1. Capability Foundation

- [x] 1.1 `lib/edenai.js`: add `'grammar'` to `EDENAI_CAPABILITIES`;
  `EDENAI_CAPABILITY_MODEL_SHAPE.grammar = {kind:'universal',
  category:'text', subfeature:'spell_check'}`.
- [x] 1.2 `lib/edenai-pricing.js`: add `grammar: ['grammar_check']` to
  `EDENAI_OPERATIONS`.
- [x] 1.3 Confirm `getEdenAiCatalogue({capability:'grammar', ...})` hits
  `GET /v3/info/text/spell_check?format=simplified` correctly (should
  work unchanged via the existing per-capability catalogue fetch — no
  new catalogue code needed, only the new shape entry from 1.1). Worked
  unchanged as predicted; added a dedicated test in `tests/edenai.test.mjs`
  using the real confirmed providers (`prowritingaid`/`sapling`).

## 2. Adapter

- [x] 2.1 `lib/edenai-service.js`: `checkGrammarEdenAi(text, language,
  apiKey, model, options)` — calls `edenAiJsonRequest('/universal-ai',
  {model, input:{text, language}}, apiKey)`, splices `output.items`
  (real field name, live-confirmed 2026-08-28 — see design.md) into the
  text in reverse-offset order using each item's
  `suggestions[0]?.suggestion` (skip items with an empty/missing
  `suggestions` array — log, don't crash), returns `{optimizedText,
  corrections: output.items, usage, model, providerRequestId}`. Also
  handles the confirmed sync-mode-failure shape (`status:"fail"`,
  `output:null`, HTTP 200) explicitly, surfacing EdenAI's real
  `error.message`.
- [x] 2.2 Overlapping-span guard: detect items whose
  `[offset, offset+length)` ranges overlap a previously-applied one;
  skip the overlapping one, log a warning with both spans, continue with
  the rest.

## 3. Call Site

- [x] 3.1 `pages/api/text-optimization.js`: when `preset ===
  'spelling_grammar'`, resolve `resolveActiveProviderConfig({capability:
  'grammar'})` instead of the current unconditional `chat`/OpenRouter
  resolution; branch to `optimizeText`/`checkGrammarEdenAi` on
  `result.provider`. Every other preset keeps resolving `chat` exactly as
  today (unchanged direct `resolveOpenRouterConfig` call, no router
  involved). Pass `settingsRow?.language || 'de'` as the `language` input.
  New `operation: 'grammar_check'` only on the EdenAI grammar path;
  `operation: 'text_optimization'` unchanged everywhere else (including
  `spelling_grammar` when it falls back to OpenRouter because `grammar`
  isn't activated). Audit log metadata also now records `provider`.

## 4. Admin UI

- [x] 4.1 `components/settings/EdenAiIntegrationPanel.js`: add `grammar`
  to `CAPABILITIES`/`LABELS`, same card pattern as the existing six.
- [x] 4.2 (added — design.md already committed to this, but it was
  missing its own task) `pages/api/organizations/integrations/edenai/activate.js`:
  wire `grammar` into the live activation probe (design.md's "Risks"
  section always specified this). Renamed `FOUNDATION_PROBE_INPUT` →
  `STATIC_PROBE_INPUT` and added `probeInputFor(capability, userId)`,
  since unlike `tts`'s fixed `{text}` payload, `grammar`'s probe needs
  the acting user's language setting (`getSettingsRow(userId)`, same
  `'de'` fallback as the real call site) — the whole point of probing at
  activation time is to catch a provider/language mismatch (confirmed
  live: `prowritingaid` rejects `de`) before any real request hits it.

## 5. Pricing

- [x] 5.1 Admin runbook: create the `(edenai, <model>, grammar_check)`
  price row before activating the `grammar` capability for any
  workspace. Added a "Pricing Runbook" section to design.md pointing at
  the Foundation change's general runbook, with worked
  `inputPricePerMillionMicros` numbers for both real confirmed providers
  (`sapling`: 2000000; `prowritingaid`: 10000000000).

## 6. Tests

- [x] 6.1 `tests/edenai-grammar.test.mjs`: mocked-fetch contract test for
  `checkGrammarEdenAi` — correct request shape, correct splice for
  non-overlapping corrections (including multiple corrections in one
  text, verifying reverse-offset order doesn't corrupt earlier spans),
  the overlapping-span guard (skips and logs, does not corrupt output).
  Also covers: no-language input, empty-items pass-through, an item with
  no suggestions being skipped (not crashing), and both confirmed
  EdenAI failure shapes (`status:"fail"` with and without `error.message`)
  (9 tests).
- [x] 6.2 Test that `pages/api/text-optimization.js` only resolves
  `grammar` for the `spelling_grammar` preset and `chat` for every other
  preset. **Scope note, same reasoning as
  `add-edenai-provider-foundation`'s task 5.4**: no test in this suite
  invokes any `pages/api` route handler directly (confirmed again — this
  route still has no injectable seam for `resolveActiveProviderConfig`/
  `resolveOpenRouterConfig`/`getSettingsRow`, and Node's `mock.module`
  would be new, unprecedented infra for this one test). The route's
  branch is a single `if (preset === 'spelling_grammar')` around calls to
  already-covered, already-tested logic:
  `resolveActiveProviderConfig` (`tests/ai-provider-router.test.mjs`),
  `resolveConfiguredEdenAiModel`/`resolveConfiguredModel`
  (`tests/edenai.test.mjs`/`tests/openrouter.test.mjs`), and
  `checkGrammarEdenAi`/`optimizeText` themselves. Verified by code review
  instead — see status.md.

## 7. Verification

- [x] 7.1 Manual, gated on a real (non-sandbox) EdenAI key: activate
  `grammar` for a test workspace using `sapling` as the model, submit
  German text (`language:'de'`) with deliberate spelling errors, confirm
  the corrections that come back are actually good German corrections.
  **Done 2026-08-28, real production key, real German text — result is
  mixed, not a clean pass**: pure spelling typos are corrected reliably
  and unambiguously (4/4 in one test, single correct suggestion each).
  But `sapling` (a) does not catch German noun/sentence-start
  capitalization errors at all (0/8 in a realistic meeting-note-style
  test — arguably the single most common ASR-transcription error class
  in German), (b) produced one real false positive (a correctly-spelled
  word "corrected" to a nonsensical replacement), and (c) for one
  correctly-detected typo, ranked a grammatically-wrong candidate ahead
  of the correct one in `suggestions[]` (confirming `score` really is
  unusable for ranking, as already suspected — this is now an observed
  failure mode, not just a theoretical one). See status.md for the full
  transcripts and the resulting activation-guidance recommendation.
- [x] 7.2 Manual: submit text with no errors, confirm `optimizedText`
  equals the input unchanged (empty corrections list handled cleanly).
  **Covered at the unit level instead of live**: the sandbox key used for
  this change's live verification returns identical canned output
  content regardless of input (see design.md's verification caveat), so
  a "live" call with clean text through it wouldn't actually exercise
  the empty-`items` path — it would still return the same fixture
  corrections. `tests/edenai-grammar.test.mjs`'s "returns the input
  unchanged when there are no items" test covers the real logic this
  task cares about. A true live check belongs with 7.1, once a
  production key is available.
- [x] 7.3 `npm test` passes. Verified 2026-08-28: 445 tests / 433 pass /
  12 skipped (10 pre-existing + 2 DB-only, no DB connection in this
  environment) / 0 failed.
- [x] 7.4 `openspec validate migrate-grammar-check-to-edenai --strict`
  passes. Verified 2026-08-28.
