# Change: Migrate Grammar/Spell Check To EdenAI

## Why

`text-optimization.js`'s `spelling_grammar` preset is currently lumped in
with five genuinely different rewriting presets (`friendlier`,
`more_formal`, `shorter`, `clearer`, `email_improve`) and sent to a
general chat LLM with the prompt "Correct spelling, grammar, punctuation
and obvious typos." An LLM asked to "correct" text will often rewrite
more than it was asked to — rephrasing, restructuring, or otherwise
touching content beyond actual errors — because "correction" is exactly
the kind of narrow, mechanical task a general-purpose model tends to
over-apply its own judgement to. EdenAI exposes a dedicated
`text/spell_check/{provider}` feature (live-verified 2026-08-28 against
a real sandboxed account, e.g. `text/spell_check/sapling`) that returns
a list of discrete `{text, type, offset, length, suggestions:
[{suggestion, score}]}` items instead of a free rewrite — a mechanical,
auditable diff rather than a black-box rephrase, and structurally the
same kind of "dedicated model beats general LLM for a narrow task" case
already made for translation (DeepL) elsewhere in this migration.

This is scoped as its own small, low-risk, self-contained change —
independent of `migrate-chat-tts-and-decommission-openrouter` — because
`spelling_grammar` is the only one of `text_optimization`'s six presets
this applies to (the other five are genuine LLM rewriting tasks with no
"expert model" equivalent), and because it needs no async job handling
(`text/spell_check` has no `_async` suffix — a synchronous
`/universal-ai` call, same shape already proven by the OCR/TTS-adjacent
work) and no dependency on the higher-risk live-meeting or full-chat-
cutover phases.

## What Changes

- Adds a 7th EdenAI capability, `grammar`, to
  `EDENAI_CAPABILITIES`/`EDENAI_CAPABILITY_MODEL_SHAPE` in `lib/edenai.js`
  (owned by `add-edenai-provider-foundation`, extended here — the pattern
  already established by every other migration change adding its own
  `ADDED Requirements` onto the `edenai-provider` capability namespace,
  just this once touching the capability list itself since it is
  genuinely new surface, not an existing one). Feature:
  `text/spell_check`, category `text`, not async.
- New `checkGrammarEdenAi(text, language, apiKey, model, options)` in
  `lib/edenai-service.js`: calls the feature, then splices the returned
  `corrections` (applied in reverse offset order so earlier offsets stay
  valid) into a corrected string — preserving `optimizeText()`'s existing
  `{optimizedText}` contract so `pages/api/text-optimization.js` needs
  minimal changes, while also returning the raw `corrections` array for
  future use (not consumed yet).
- `pages/api/text-optimization.js`: when `preset === 'spelling_grammar'`,
  resolves the provider via
  `resolveActiveProviderConfig({capability:'grammar'})` instead of always
  resolving `chat`/OpenRouter; the other five presets are unaffected. A
  new `grammar_check` operation (distinct from `text_optimization`, since
  EdenAI's spell-check billing unit differs structurally from LLM
  token-based pricing) is used only for this preset's EdenAI path.
- `components/settings/EdenAiIntegrationPanel.js`: adds a `grammar`
  capability card, same pattern as the existing six.
- New EdenAI `OPERATIONS` entry: `grammar: ['grammar_check']`.

## Capabilities

### New Capabilities

(none — `edenai-provider` already exists, from `add-edenai-provider-
foundation`)

### Modified Capabilities

- `edenai-provider`: adds the EdenAI Grammar/Spell-Check Adapter
  requirement, and extends the capability list itself (see above).

## Impact

- Changed: `lib/edenai.js` (capability list), `lib/edenai-service.js`
  (new export), `lib/edenai-pricing.js` (new `OPERATIONS` entry),
  `pages/api/text-optimization.js` (preset-conditional routing),
  `components/settings/EdenAiIntegrationPanel.js` (new capability card)
- Unchanged: the other five `text_optimization` presets and their
  existing OpenRouter/EdenAI-chat path (once that lands in
  `migrate-chat-tts-and-decommission-openrouter`)
