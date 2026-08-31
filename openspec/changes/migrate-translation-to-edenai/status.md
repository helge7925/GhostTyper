# Status: Migrate Translation To EdenAI

Last updated: 2026-08-28

## Current State

- **Implemented**, one open manual-verification task remaining (5.5).
  Second capability decided under the `hardcode-edenai-models`
  architecture (`chat` was first, for `spelling_grammar`/general text
  optimization).

## Design correction: dedicated MT adapter rejected, chat wins (2026-08-28)

This change originally planned an EdenAI-native translation adapter
(DeepL/Google/Amazon/Microsoft/ModernMT via
`translation/automatic_translation`), on the reasoning that a dedicated MT
product should beat a general-purpose LLM the same way dedicated OCR/STT
products do elsewhere in this migration. Before writing that adapter, a
live production-key comparison was run (same rigor as
`hardcode-edenai-models`'s chat-model testing) and reversed the plan:

1. **Schema check**: `GET /v3/info/translation/automatic_translation`
   confirmed the dedicated feature's input is exactly
   `{text, target_language, source_language}` — no prompt/instruction
   field, no glossary passthrough. The app's placeholder-masking glossary
   guard (`lib/translation-glossary.js`) has no channel to reach it at
   all, regardless of translation quality.
2. **Stress test anyway**: even setting (1) aside, a harder DE/EN test
   (colloquial register, an idiom, markdown, embedded placeholder tokens)
   found real, reproducible defects in every dedicated engine — a
   spurious code-fence artifact from Google, broken markdown-bold syntax
   plus a real mistranslation from ModernMT, inconsistent Sie/du register
   from DeepL and Amazon — that `chat`/`mistral-small-latest` did not
   have. `chat` also correctly resolved one idiom ("Minutes"→"Protokoll")
   every dedicated engine got wrong in both directions.
3. **JSON segment-mode check**: `chat`'s strict-JSON array output (needed
   for office/PDF document translation) was verified stable across 3
   reruns each on two segment batches, including edge cases (an empty
   segment, a placeholder-only segment). This resolves the master plan's
   Risk #3 ("unbestätigtes JSON-Mode-Zuverlässigkeit") for
   `mistral-small-latest`.

Full evidence table in design.md. Decision: translation routes through
`chat` — no dedicated `translation` capability. `lib/edenai.js`'s
`EDENAI_CAPABILITIES`/`EDENAI_CAPABILITY_MODEL_SHAPE`/
`EDENAI_HARDCODED_MODEL` now list five capabilities, not six; this
exactly mirrors how `grammar` was removed in `hardcode-edenai-models` in
favor of a `chat` preset. Flagged explicitly per this project's standing
transparency practice — proposal.md/design.md were rewritten in place
(not superseded by a new change) since implementation had not started
under the original plan.

## Implementation (2026-08-28)

- `lib/edenai-service.js`: new `translateTextEdenAi`/
  `translateTextSegmentsEdenAi`, byte-for-byte mirroring
  `lib/ai-service.js`'s `translateText`/`translateTextSegments` (same
  prompt shape, same `STRICT_PLACEHOLDER_INSTRUCTION`, same return
  contract) against EdenAI's `/chat/completions`.
- `pages/api/translate.js`: the inline-translation `translate` closure
  now resolves `resolveActiveProviderConfig({capability:'chat'})` instead
  of hardcoding OpenRouter, branching to `translateText`/
  `translateTextEdenAi`. Audit metadata gained a `provider` field.
- `pages/api/translate/file.js`: `translateSegmentsWithGlossary()` gained
  a `provider` parameter and branches to `translateTextSegments`/
  `translateTextSegmentsEdenAi`; all three call sites (office,
  PDF-in-place, PDF-OCR-fallback) updated via a shared
  `translateProviderOptions()` closure. The top-level model/key gate
  changed from an unconditional `openrouter.apiKey` check to one that
  follows `resolveActiveProviderConfig`'s result — OpenRouter is only
  required now for the OCR fallback step specifically (unmigrated), not
  for translation itself. Audit metadata gained `provider` (office/
  PDF-in-place) or `ocrProvider`/`translationProvider` (PDF-OCR-fallback,
  since that path always uses OpenRouter for OCR but may use either
  provider for translation).
- `lib/edenai.js`: `translation` removed from `EDENAI_CAPABILITIES`,
  `EDENAI_CAPABILITY_MODEL_SHAPE`, `EDENAI_HARDCODED_MODEL`.
- `lib/edenai-pricing.js`: `EDENAI_OPERATIONS.translation` removed;
  `translation`/`office_translation`/`live_translation` moved under
  `EDENAI_OPERATIONS.chat` (now 7 operations), mirroring
  `lib/openrouter-pricing.js`'s existing grouping.
- `components/settings/EdenAiIntegrationPanel.js`: removed the
  `translation` label — the panel is capability-array-driven, so the
  card disappears automatically; no other change needed.
- Tests: new `tests/edenai-translation.test.mjs` (11 tests, mocked
  fetch, mirrors `tests/edenai-optimize-text.test.mjs`'s pattern).
  `tests/edenai.test.mjs`, `tests/edenai-pricing.test.mjs`,
  `tests/edenai-pricing-gate.test.mjs` updated for the five-capability
  list and the `chat`-owns-translation-operations pricing shape.
  `tests/translation-glossary.test.mjs` needed no changes (provider-
  agnostic by construction). `npm test` → 445 tests / 433 pass / 12
  skipped / 0 failed. Lint clean.
- Verification: live-called the actual shipped
  `translateTextEdenAi`/`translateTextSegmentsEdenAi` (not a
  reimplementation) against production EdenAI — both functions correct,
  placeholders preserved, JSON-array shape correct. Key deleted from
  scratchpad immediately after, no leak (repo-wide grep clean).
- `openspec validate migrate-translation-to-edenai --strict` passes.

## Outstanding

- Task 5.5: full DB + `next dev` + browser manual verification (activate
  `chat`, submit inline/office/PDF translations through the real UI,
  confirm `usage_log` and layout-report output) — not yet run. 5.4
  already confirmed the EdenAI call itself is correct; 5.5 is the
  remaining routing/UI wiring check.
- `lib/vexa-bridge.js`'s `runTranslationDelta()` (live in-meeting
  translation) is explicitly out of scope here — deferred to
  `migrate-live-meeting-stt-to-edenai`, will also route through `chat`
  when it migrates.
- EdenAI's native document-translation product remains deliberately not
  adopted (see design.md) — a possible later, separate product decision.
