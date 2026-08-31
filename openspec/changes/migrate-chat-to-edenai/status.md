# Status: Migrate Chat/Analysis To EdenAI

Last updated: 2026-08-30

## Current State

- **Implemented** (code + tests + live verification + docs). Pulled out
  of the originally-planned `migrate-chat-tts-and-decommission-openrouter`
  bundle into its own change — see that change's status.md for the note
  recording the split (same pattern `migrate-tts-to-edenai` already
  established). This closes the last of the five call sites the master
  plan's chat/analysis exception list had deliberately deferred across
  `migrate-batch-transcription-to-edenai`, `migrate-ocr-extraction-to-
  edenai`, and `hardcode-edenai-models`. One manual real-workspace
  verification task remains (6.5) — same "code done, real-workspace
  smoke-test still open" state every prior change in this sequence
  finished in.

## Live verification found and fixed a real defect (2026-08-30)

This was explicitly the highest-risk unverified assumption in the whole
OpenRouter→EdenAI migration per the original bundled plan — whether
EdenAI's chat model honors `response_format:{type:'json_object'}`
reliably enough to carry the app's template/table-extraction feature.
Verified directly, not assumed:

1. The strengthened activation probe
   (`probeEdenAiChatStructuredOutput`) passed live on the first
   attempt.
2. A realistic synthetic `data_table` extraction (invented
   construction-materials order, never real user data) round-tripped
   correctly through `analyzeTranscriptionEdenAi` — right row count,
   correctly-typed numbers, sensible columns. One row carried an extra
   field the others didn't (violates the prompt's own "same columns
   every row" rule) — confirmed this is already handled gracefully by
   the app's existing, unchanged `normalizeDataTableAnalysis` normalizer
   (null-fills missing keys), so not a blocker.
3. `generateTemplateEdenAi` **failed** on the first live test — the
   hardcoded model wrapped its entire response in a ```` ```json ````
   fence instead of returning the natural-language instruction text the
   feature requires, reproducibly across 3 different test goals (support
   tickets, medical letters, sales-call analysis). Root-caused to
   genuine ambiguity in `TEMPLATE_GENERATOR_PROMPT`'s own wording (it
   asks the model to write an instruction that itself demands JSON from
   a *different*, future AI call — this model conflated that with
   answering in JSON itself). Fixed with one added sentence, applied to
   the shared prompt (both `generateTemplate` and `generateTemplateEdenAi`
   use it) rather than a provider-specific fork. Re-verified live across
   all 3 original goals with the fix in place — every response now
   returns correct natural-language instruction text. Full before/after
   evidence in design.md.

This is the same class of finding as `hardcode-edenai-models`'s
spelling_grammar synonym-substitution fix: a real, live-discovered
defect, fixed at the prompt level rather than by discarding the model,
verified before being called "done" rather than assumed correct because
it looked reasonable on paper.

## Implementation (2026-08-30)

- `lib/ai-service.js`: `getAnalysisPrompt` exported (was private).
- `lib/edenai-service.js`: new `analyzeTranscriptionEdenAi`,
  `generateTemplateEdenAi` — both mirror their OpenRouter counterparts
  exactly (same prompts/contracts, only the transport differs).
- `lib/edenai-probes.js`: chat capability probe strengthened with a
  structured-output check (`probeEdenAiChatStructuredOutput`), run
  automatically alongside the existing plain-text check.
- `lib/prompts.js`: `TEMPLATE_GENERATOR_PROMPT` — real, live-verified
  fix (see above), not a speculative hardening.
- Five call sites migrated: `pages/api/ocr.js` (analysis block —
  extraction was already on EdenAI), `lib/transcription-worker.js`
  (analysis block — STT was already on EdenAI, now resolved via a
  second, independent `resolveActiveProviderConfig` call since the two
  capabilities activate independently), `pages/api/templates/generate.js`,
  `pages/api/knowledge-prep/text.js`, `lib/manual-analysis.js`. All
  follow the exact branching pattern `pages/api/text-optimization.js`
  already established for `spelling_grammar`.
- Tests: `tests/edenai-chat.test.mjs` (8 new tests), 4 new tests in
  `tests/edenai-probes.test.mjs` (plus one existing test updated for the
  chat probe's new second call), 1 new regression-guard test in
  `tests/prompts.test.mjs`. `npm test` → 485 tests / 473 pass / 12
  skipped / 0 failed (up from 474/462/12/0). Lint clean.
- `openspec validate migrate-chat-to-edenai --strict` passes.
- Key handling: fresh production EdenAI key provided by the user for
  this verification round, written to scratchpad only (chmod 600),
  deleted immediately after use, repo-wide grep confirmed no leak.

## Real gap found and closed: chat's price was never actually sourced (2026-08-31)

Task 4.1 originally said no new price work was needed here, reasoning
that `chat`'s pricing requirement already existed from earlier
capabilities. True, but incomplete: nobody in this migration sequence
had ever actually looked up EdenAI's real rate for
`mistral/mistral-small-latest` — a gap in the research, not a
deliberately deferred task. Fetched live from EdenAI's own
`GET /v3/models?feature=text&subfeature=chat` catalogue: $0.15/million
input tokens, $0.60/million output tokens (exactly Mistral's own direct
API pricing, no visible EdenAI markup on this entry). All eight `chat`
operations, plus `transcription` (gladia) and TTS's four operations from
the earlier changes in this sequence, are now seeded automatically via
`lib/pricing-seed.js` — see `migrate-live-meeting-stt-to-edenai/status.md`
for the full cross-cutting writeup of that seeding mechanism (it covers
Mistral's row too, not just EdenAI's).

## Outstanding

- Task 6.5: full manual verification through the real UI (activate
  `chat` on a test workspace, run a template-driven analysis, a
  `data_table` extraction, and a template-generation request, confirm
  `usage_log` shows `provider='edenai'` rows) — not yet run. Same
  open-item pattern as every other change in this migration sequence.
- The residual `data_table` row-key-inconsistency risk (see "Live
  verification" above) is acknowledged, not eliminated — it's a generic
  LLM-JSON-compliance gap the app's existing normalizer already defends
  against for every provider, not something this change could or should
  try to eliminate at the source.
- The full OpenRouter decommission
  (`migrate-chat-tts-and-decommission-openrouter`'s section 5) remains
  entirely untouched and deliberately out of scope — gated on a
  production soak period for every migrated capability, none of which
  have run in production yet.
