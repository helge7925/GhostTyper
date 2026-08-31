# Design: Migrate Chat/Analysis To EdenAI

## The structured-output probe

`probeEdenAiChatStructuredOutput` (`lib/edenai-probes.js`) sends:

```
system: "Reply with only a JSON object, no other text."
user: 'Return a JSON object with exactly two fields: "status" (the
       string "ok") and "items" (a JSON array containing exactly 3
       short strings).'
response_format: { type: 'json_object' }
```

and validates the parsed result is an object (not array), has
`status === 'ok'`, and `items` is an array of exactly 3 strings —
structural shape, not an exact value match, since a compliant model may
still legitimately vary formatting details that don't affect JSON-mode
compliance itself. Called automatically as part of `probeEdenAiChat`
(alongside the pre-existing plain-text check) whenever `chat` is
activated for a workspace — this is the closest equivalent this app has
to OpenRouter's `supported_parameters` catalogue signal
(`resolveSupportedParameters`), which gates JSON-mode reliance on
OpenRouter before this app ever calls it; EdenAI exposes no such
catalogue field, so a live per-activation probe is the only substitute.

Live-verified 2026-08-30 against the real hardcoded model
(`mistral/mistral-small-latest`): passed on the first attempt, both the
plain-text and structured-output checks.

## Live verification: `analyzeTranscriptionEdenAi` against a real `data_table` extraction

Synthetic German business text (never real user data — an invented
construction-materials order, three line items, a delivery date, an
invoice number) run through the real `analyzeTranscriptionEdenAi`
function end-to-end, template `data_table`:

- Correct row count (3), correct column set inferred from context
  (`bestellposition`, `artikelbezeichnung`, `menge`, `einheit`,
  `einzelpreis`, `gesamtpreis`, `lieferdatum`, `rechnungsnummer`).
- Numbers returned as JSON numbers, not strings (`"menge": 50`, not
  `"menge": "50"`) — this matters, since the prompt explicitly demands
  it and downstream table rendering assumes it.
- One real imperfection: the invoice number (`rechnungsnummer`,
  mentioned once for the whole order, not per line item) was attached
  only to the third row, not present as `null` on the first two —
  violates the prompt's own "every row must use the same columns" rule.
- `normalizeDataTableAnalysis` (unchanged, already handles this for
  every provider) accepted the response without error and produced a
  clean, uniformly-keyed table (`lieferdatum: null`,
  `rechnungsnummer: null` filled in for the two rows missing them).
  This is not a new EdenAI-specific gap — any LLM's structured output
  can be imperfect in this exact way, which is precisely why this
  normalizer already exists and is provider-agnostic.

**Verdict: GO.** The core JSON-mode contract works; the one imperfection
found is already within the blast radius the app's existing downstream
validation was built to absorb.

## Real defect found and fixed: `generateTemplateEdenAi`'s free-text mode

Live-tested with 3 different goals ("Support-Tickets nach Dringlichkeit
zusammenfassen", "Protokoll für Arztbriefe", "Analyse von
Verkaufsgesprächen"). Before the fix, **every single one** returned its
entire response wrapped in a ```` ```json ```` fence around a literal
JSON object (keys like `"rolle"`, `"aufgabe"`, `"format"`) — not the
natural-language system-instruction text `generateTemplate`'s contract
requires and that downstream `getAnalysisPrompt` treats as raw prompt
text to prepend before the actual transcript.

Root cause: `TEMPLATE_GENERATOR_PROMPT` instructs the model to write an
instruction that *itself* mandates JSON output from a **different**
future AI call (criterion 2: "Die KI MUSS immer im JSON-Format
antworten..."). The prompt never explicitly distinguished "the
instruction you write should require JSON" from "your own answer right
now should be JSON" — ambiguous enough that this model resolved it the
wrong way, consistently, across every goal tested.

Fix: one added sentence, inserted after criterion 6, before the
"return only the instruction text" closing line:

> WICHTIG: Deine eigene Antwort auf diese Aufgabe hier ist selbst reiner
> Fließtext, KEIN JSON und KEIN Code-Block. Die JSON-Format-Pflicht aus
> Punkt 2 gilt für eine ANDERE, künftige KI, die deine Anweisung später
> befolgt — nicht für deine jetzige Antwort. Gib also normalen,
> lesbaren Anweisungstext zurück, der lediglich beschreibt, welches
> JSON-Format diese künftige KI verwenden soll.

Re-verified live across all 3 original goals after the fix: every
response now returns proper natural-language instruction text (role
assignment in prose, an embedded JSON-structure illustration as part of
that prose — exactly matching `DEFAULT_PROMPTS.data_table`'s own
established style — followed by style rules), reproducible, no
regression to the fenced/bare-JSON behavior in any of the three reruns.

Applied to the **shared** `TEMPLATE_GENERATOR_PROMPT`
(`lib/prompts.js`), used by both `generateTemplate` (OpenRouter) and
`generateTemplateEdenAi` (EdenAI), rather than forking a
provider-specific variant — the ambiguity this fix resolves is in the
prompt's own wording, not something specific to this one model, so any
future model on either provider benefits from the same clarification.
This mirrors the precedent set by `optimizeText`/`optimizeTextEdenAi`'s
identical `spelling_grammar` synonym-substitution fix in
`hardcode-edenai-models` — a real defect found via live testing, fixed
at the prompt level, applied wherever the shared behavior is expected.
No test in this suite asserted the old prompt text verbatim, so nothing
needed updating besides the new regression guard added here
(`tests/prompts.test.mjs`).

## Call-site branching pattern

All five migrated call sites follow the exact structure
`pages/api/text-optimization.js` already established for
`spelling_grammar`:

```js
const active = await resolveActiveProviderConfig({ userId, organizationId, capability: 'chat' });
if (active.provider === 'edenai') {
  model = active.model; // hardcoded, no per-request override
  // call *Edenai variant with active.apiKey, active.model
} else {
  model = resolveConfiguredModel(active, 'chat', requestModel || settingsRow?.preferred_model);
  // call OpenRouter variant, unchanged, using `active` in place of a
  // separately-resolved `openrouter` config — resolveActiveProviderConfig's
  // OpenRouter branch returns {provider:'openrouter', ...openrouterConfig},
  // a strict superset of what a raw resolveOpenRouterConfig() call
  // would have returned, so every existing openrouter.* field access
  // (baseUrl, defaultModels, organizationId, ttsVoices, etc.) keeps
  // working unchanged.
}
executeReservedSpend({ ..., provider: active.provider, model, ... }, callProvider);
```

`pages/api/ocr.js` is the one file where this simplified further: OCR
extraction (migrated earlier, in `migrate-ocr-extraction-to-edenai`) and
analysis (migrated here) both resolve the identical `chat` capability
for the identical user/org, so one `resolveActiveProviderConfig` call
now serves both blocks — the separate raw `resolveOpenRouterConfig` call
that file previously kept just for the analysis block was removed as
redundant, not as a new requirement of this change.

`lib/transcription-worker.js` needed two independent
`resolveActiveProviderConfig` calls in the same function
(`activeTranscription` for `capability:'transcription'`,
`activeChat` for `capability:'chat'`) since a workspace can activate
either capability on EdenAI independently of the other — this mirrors
the same two-provider-in-one-job structure
`migrate-batch-transcription-to-edenai/design.md` already documented for
the STT/analysis split, just completing the analysis half that change
deliberately deferred.

## Risks / Trade-offs

- The one row-key inconsistency found in `data_table` extraction (see
  above) is a generic LLM-JSON-compliance risk, not fully eliminated —
  only shown to be already absorbed by existing downstream code for the
  one case tested. A more adversarial/complex real transcript could
  still surface a genuinely broken response `sanitizeStructuredValue`'s
  `{raw: content}` fallback would catch (returning unusable raw text
  instead of a parsed table) — this is the same residual risk
  `analyzeTranscription`'s OpenRouter path already carries today, not a
  new one introduced by this migration.
- `generateTemplateEdenAi`'s fix was verified against 3 goals spanning
  fairly different domains (support tickets, medical letters, sales
  calls) — a reasonable spread, but not exhaustive; a sufficiently
  unusual goal could in principle still trigger the old failure mode.
  No code-level defensive parsing (e.g. stripping a code fence if
  present) was added on top of the prompt fix — the live evidence showed
  the prompt-level fix fully resolves the observed behavior, and adding
  a silent recovery path for a failure mode that's supposed to be fixed
  would mask a regression instead of surfacing it.
