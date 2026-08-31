# Change: Migrate Chat/Analysis To EdenAI

## Why

`chat`'s hardcoded EdenAI model (`mistral/mistral-small-latest`) has been
live and in production use since `hardcode-edenai-models`, but only for
`translation`, OCR, and the `spelling_grammar` text-optimization preset.
Five call sites still hardcoded `resolveOpenRouterConfig`/
`provider:'openrouter'` for transcription-analysis and template
generation, deliberately left untouched by every prior workload
migration in this sequence per the master plan's own standing exception
list (see `migrate-batch-transcription-to-edenai/design.md`'s "Design
correction" section for why analysis specifically was carved out of that
change).

Pulled out of the originally-planned
`migrate-chat-tts-and-decommission-openrouter` bundle into its own
change, same reasoning as `migrate-tts-to-edenai`: this migration's
outcome depends only on chat's own live verification, not on the
separate, much larger, not-yet-started full OpenRouter decommission that
change also covers — deleting OpenRouter's code is explicitly deferred
until every migrated capability has soaked in production, which none of
them have yet.

This change closes the "highest-consequence unverified assumption" the
original bundled plan flagged: whether EdenAI's `/chat/completions`
honors `response_format:{type:'json_object'}` reliably enough to carry
`analyzeTranscription`'s structured template/table-extraction contract —
the app's highest-value feature. Live-tested 2026-08-30 against a
realistic `data_table` extraction (three line items, mixed number/date/
text fields) and the app's own downstream normalizer:

- JSON-mode compliance: **confirmed**. Correct column typing (numbers as
  numbers, not strings), sensible column naming, correct row count.
- One real imperfection found: one row carried an extra field
  (`rechnungsnummer`) the other two rows omitted, violating the
  prompt's own "every row must use the same columns" rule. **Not a
  blocker** — `normalizeDataTableAnalysis` (the app's existing
  downstream normalizer, unchanged by this migration) already
  union-fills missing keys with `null` across all providers; this is a
  generic LLM-JSON-compliance gap the app already defends against, not
  an EdenAI-specific regression.

A second, more serious defect was found and fixed during this same
verification round, in `generateTemplateEdenAi` (free-text mode, no
JSON contract): the hardcoded chat model consistently wrapped its
**entire** response in a ```` ```json ```` code fence (or a bare JSON
object) instead of the natural-language instruction text the feature
requires — confirmed reproducible across 3 different test goals. Root
cause: `TEMPLATE_GENERATOR_PROMPT`'s own wording asks the model to write
an instruction that itself demands JSON output from a *different*,
*future* AI call — ambiguous enough that this model conflated "describe
a JSON format" with "respond in JSON now." Fixed with one clarifying
sentence added to the prompt, applied to the **shared**
`TEMPLATE_GENERATOR_PROMPT` (`lib/prompts.js`, used by both
`generateTemplate` and `generateTemplateEdenAi`) rather than diverging
per-provider, since the ambiguity could in principle affect any model,
not only this one. Re-verified live afterward across all 3 goals: every
response now returns proper natural-language instruction text.

## What Changes

- `lib/edenai-service.js` gains `analyzeTranscriptionEdenAi` (mirrors
  `analyzeTranscription`'s prompt, `response_format:{type:'json_object'}`
  contract, and `sanitizeStructuredValue` guard exactly — reuses
  `getAnalysisPrompt`, now exported from `lib/ai-service.js` rather than
  duplicated) and `generateTemplateEdenAi` (mirrors `generateTemplate`
  exactly, no JSON mode).
- `lib/edenai-probes.js`'s chat capability probe gains a second check,
  `probeEdenAiChatStructuredOutput`: validates that
  `response_format:{type:'json_object'}` actually returns a well-formed
  JSON object with the requested shape, not just that `/chat/completions`
  responds at all. This is the concrete, per-model gate standing in for
  OpenRouter's `supported_parameters` catalogue signal, which EdenAI has
  no equivalent of.
- `lib/prompts.js`'s `TEMPLATE_GENERATOR_PROMPT` gains one clarifying
  sentence (see "Why" above) — a real, live-verified fix, not a
  speculative hardening.
- Five call sites — `pages/api/templates/generate.js`,
  `pages/api/knowledge-prep/text.js`, `lib/manual-analysis.js`, the
  analysis block of `pages/api/ocr.js` (extraction was already migrated
  in `migrate-ocr-extraction-to-edenai`), and the analysis block of
  `lib/transcription-worker.js` (the STT block was already migrated in
  `migrate-batch-transcription-to-edenai`) — now resolve
  `resolveActiveProviderConfig({capability:'chat'})` and branch
  `analyzeTranscriptionEdenAi`/`analyzeTranscription` or
  `generateTemplateEdenAi`/`generateTemplate`, following the same
  branching pattern `pages/api/text-optimization.js` already established
  for `spelling_grammar`: when EdenAI is active, its hardcoded model is
  used directly with no per-request override; when OpenRouter is active,
  the existing catalogue-driven `resolveConfiguredModel`/user-preference
  flow is unchanged.
- `pages/api/ocr.js`: since OCR extraction and analysis now resolve the
  identical `chat` capability, one `resolveActiveProviderConfig` call
  serves both blocks — the separate raw `resolveOpenRouterConfig` call
  this file previously kept only for the analysis block is removed.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `edenai-provider`: the `chat` capability's existing "Hardcoded
  Per-Capability Model" requirement now explicitly covers analysis and
  template generation too, and gains a scenario for the strengthened
  structured-output activation probe.

## Impact

- Changed: `lib/edenai-service.js` (two new exports), `lib/edenai-probes.js`
  (chat probe strengthened), `lib/ai-service.js` (`getAnalysisPrompt`
  exported, no behavior change), `lib/prompts.js`
  (`TEMPLATE_GENERATOR_PROMPT` — a real prompt fix, affects both
  providers), `pages/api/templates/generate.js`,
  `pages/api/knowledge-prep/text.js`, `lib/manual-analysis.js`,
  `pages/api/ocr.js` (analysis block), `lib/transcription-worker.js`
  (analysis block)
- Unchanged: `analyzeTranscription`/`generateTemplate` (OpenRouter path,
  used as-is by both providers' branches), `normalizeDataTableAnalysis`,
  `normalizeAndValidateTableAnalysis`, `lib/edenai-pricing.js`'s `chat`
  operation list (already correct from the foundation phase)
- Deliberately out of scope: the full OpenRouter decommission (section 5
  of `migrate-chat-tts-and-decommission-openrouter`) — that stays gated
  on a production soak period per that change's own status.md, not
  started here or by `migrate-tts-to-edenai`
