# Tasks: Migrate Chat/Analysis To EdenAI

## 1. EdenAI Chat Adapters

- [x] 1.1 `lib/ai-service.js`: exported `getAnalysisPrompt` (was
  private) so the EdenAI adapter reuses the exact same prompt builder
  rather than duplicating template-handling logic.
- [x] 1.2 `lib/edenai-service.js`: `analyzeTranscriptionEdenAi` (mirrors
  `analyzeTranscription` exactly — same prompt, same
  `response_format:{type:'json_object'}` contract, same
  `sanitizeStructuredValue` guard) and `generateTemplateEdenAi` (mirrors
  `generateTemplate` exactly, no JSON mode).
- [x] 1.3 `lib/edenai-pricing.js`'s `chat` operation list was already
  correct from the foundation phase (`analysis`, `text_optimization`,
  `template_generation`, `knowledge_prep`, plus translation/OCR
  operations added by their own migrations) — no change needed.

## 2. Pre-Cutover Probe

- [x] 2.1 `lib/edenai-probes.js`: `probeEdenAiChatStructuredOutput` —
  sends a fixed `response_format:{type:'json_object'}` request and
  validates the parsed result's structural shape (not an exact value
  match). Called automatically from `probeEdenAiChat` alongside the
  existing plain-text check.
- [x] 2.2 Prototyped and verified live against the real hardcoded model
  (`mistral/mistral-small-latest`) early, before wiring the five call
  sites below — see design.md's "Live verification" sections. Passed on
  the first attempt for the probe itself; found and fixed a real defect
  in `generateTemplateEdenAi`'s free-text path (see task 1.2/3.1's note
  and design.md).

## 3. Call Sites

- [x] 3.1 `pages/api/ocr.js` (analysis block — extraction was already
  migrated in `migrate-ocr-extraction-to-edenai`): replaced the
  separate raw `resolveOpenRouterConfig` call the analysis block
  previously kept with the same `resolveActiveProviderConfig({capability:
  'chat'})` result the extraction block already resolves — one call now
  serves both.
- [x] 3.2 `lib/transcription-worker.js` (analysis block — the STT block
  was already migrated in `migrate-batch-transcription-to-edenai`):
  added a second, independent `resolveActiveProviderConfig({capability:
  'chat'})` call (`activeChat`), since a workspace can activate
  `transcription` and `chat` on EdenAI independently.
- [x] 3.3 `pages/api/templates/generate.js`: replaced
  `resolveOpenRouterConfig`/hardcoded `provider:'openrouter'` with the
  router, branching `generateTemplateEdenAi`/`generateTemplate`.
- [x] 3.4 `pages/api/knowledge-prep/text.js`: same swap, branching
  `analyzeTranscriptionEdenAi`/`analyzeTranscription` for the
  `data_table` extraction flow.
- [x] 3.5 `lib/manual-analysis.js`: same swap for the manual
  (re-run/edit-and-reanalyze) analysis job path.
- [x] 3.6 Real defect found and fixed during live verification, not
  scoped to any single call site: `lib/prompts.js`'s
  `TEMPLATE_GENERATOR_PROMPT` gained one clarifying sentence after the
  hardcoded EdenAI model was found to consistently wrap its response in
  a JSON code fence instead of returning plain instruction text — see
  design.md. Applied to the shared prompt (both providers), not forked.

## 4. Pricing

- [x] 4.1 No new price rows needed — `chat`'s pricing was already
  required (and, per every prior status.md in this sequence, not yet
  created) by the capabilities that already used it
  (`translation`/OCR/`spelling_grammar`). Analysis/template-generation/
  knowledge-prep operations were already listed in
  `lib/edenai-pricing.js`'s `EDENAI_OPERATIONS.chat` from the foundation
  phase, so the same price row that already gates chat activation
  covers these operations too — no runbook task to add here.

## 5. Tests

- [x] 5.1 `tests/edenai-chat.test.mjs` (new, 8 tests):
  `analyzeTranscriptionEdenAi` (request shape, JSON-object parsing,
  malformed-JSON fallback, JSON-array-response handling, German/English
  system prompt selection, `MODEL_UNAVAILABLE` guard) and
  `generateTemplateEdenAi` (request shape, trimmed `promptText`,
  `MODEL_UNAVAILABLE` guard).
- [x] 5.2 `tests/edenai-probes.test.mjs`: 4 new tests for
  `probeEdenAiChatStructuredOutput` (posts `response_format` correctly,
  fails on non-JSON output, fails on wrong-shaped JSON) plus updated the
  existing plain-text-probe test for the now-two-call chat probe.
- [x] 5.3 `tests/prompts.test.mjs`: regression guard asserting
  `TEMPLATE_GENERATOR_PROMPT` still contains the "your own response is
  plain text, not JSON" clarification — a real, live-discovered defect
  that a future edit could silently reintroduce.
- [x] 5.4 `npm test` passes (485 tests / 473 pass / 12 skipped / 0
  failed, up from 474/462/12/0). `npx eslint .` clean.

## 6. Verification

- [x] 6.1 Live-called `probeEdenAiCapability({capability:'chat', ...})`
  against production EdenAI — passed (both plain-text and
  structured-output checks).
- [x] 6.2 Live-called `analyzeTranscriptionEdenAi` end-to-end against a
  realistic synthetic `data_table` extraction (never real user data) —
  correct row count and column typing; one row-key inconsistency found,
  confirmed already absorbed by the existing, unchanged
  `normalizeDataTableAnalysis`. See design.md.
- [x] 6.3 Live-called `generateTemplateEdenAi` across 3 different goals
  — found a real defect (JSON-wrapped output instead of plain text),
  root-caused, fixed at the shared-prompt level, re-verified live across
  all 3 goals with the fix applied. See design.md.
- [x] 6.4 `openspec validate migrate-chat-to-edenai --strict` passes.
- [ ] 6.5 Manual: activate EdenAI for `chat` on a test workspace (probe
  passed, pricing satisfied), run a real template-driven analysis, a
  `data_table` extraction, and a template-generation request through
  the actual UI, confirm `usage_log` records `provider='edenai'` rows.
  Not yet run — same open-item pattern as every other change in this
  migration sequence's final manual-verification task.
