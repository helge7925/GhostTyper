# Change: Hardcode EdenAI Models (Remove Catalogue-Based Selection)

## Why

`migrate-grammar-check-to-edenai` was fully implemented and verified
against a real EdenAI production key (its task 7.1). The verification
itself produced the trigger for this change: a head-to-head comparison
of `text/spell_check/sapling` (the dedicated grammar/spell-check feature
that change was built around) against EdenAI's own `chat` capability
using a well-scoped correction prompt, on the same German test texts.
`sapling` missed every German capitalization error (0/8 in a realistic
meeting-note text) and produced a false positive; EdenAI chat
(`anthropic/claude-sonnet-5`) corrected all three test texts perfectly,
including a deliberately messy, colloquial stress test, with no
over-rewriting. This directly contradicts the assumption
`migrate-grammar-check-to-edenai`'s own proposal was built on — that a
dedicated EdenAI feature beats a general LLM for this narrow task, the
same case already proven true for translation (DeepL). It does not hold
for German grammar/spelling via `sapling`.

This finding prompted a broader product decision, made by the user: stop
exposing a live-catalogue-driven model picker to admins at all, for any
EdenAI capability. Instead, each capability gets exactly one model,
chosen once by the team through a real head-to-head comparison test (the
same method that surfaced the finding above), and hardcoded into the
application. An org admin's entire EdenAI setup becomes: paste an API
key, activate a capability. No catalogue browsing, no allowlist, no
per-capability default-model dropdown.

This is a deliberate reversal of `add-edenai-provider-foundation`'s
"Live EdenAI Catalogue" design (itself a correction of an even earlier
"static registry" draft) and of `migrate-grammar-check-to-edenai`'s
dedicated `grammar` capability — both already shipped, both fully
functional, neither wrong on their own terms. This change supersedes
them with a simpler, curated design based on what was actually learned
by using the real API, not by re-litigating the earlier reasoning as a
mistake.

## What Changes

- **Remove the `grammar` EdenAI capability entirely.** `checkGrammarEdenAi`,
  `text/spell_check`'s shape entry, its pricing operation, its admin
  panel card, and its dedicated tests are deleted.
  `pages/api/text-optimization.js`'s `spelling_grammar` preset now
  routes through the ordinary `chat` capability, like the other five
  presets — same narrow correction prompt as before, different provider
  routing.
- **All six presets in `text-optimization.js` route uniformly through
  `resolveActiveProviderConfig({capability:'chat'})`**, not just
  `spelling_grammar` as the superseded change had it. This pulls a small
  piece of `migrate-chat-tts-and-decommission-openrouter`'s eventual
  scope forward — only for this one route, not the other five chat call
  sites (`ocr.js`, `transcription-worker.js`, `templates/generate.js`,
  `knowledge-prep/text.js`, `manual-analysis.js`), which stay
  OpenRouter-only until that later change.
- **New `optimizeTextEdenAi`** in `lib/edenai-service.js`, mirroring
  `lib/ai-service.js`'s `optimizeText` exactly (same preset-instruction
  map, same prompt shape, same `{optimizedText, usage, model,
  providerRequestId}` return contract) but calling EdenAI's
  `/chat/completions` instead of OpenRouter's.
- **New `EDENAI_HARDCODED_MODEL` map** in `lib/edenai.js`: one model
  string per capability, `null` where no comparison test has happened
  yet. `chat: 'mistral/mistral-small-latest'` is decided by this change
  (evidence in design.md, including a same-day revision away from
  `anthropic/claude-sonnet-5` on cost and a user requirement for an
  open-weight model from a European provider); the other five stay
  `null`, decided later, one at a time, each its own small follow-up.
- **`spelling_grammar`'s instruction gains one sentence**, in both
  `optimizeText` (`lib/ai-service.js`, OpenRouter) and
  `optimizeTextEdenAi` (kept identical on purpose): an explicit
  prohibition on synonym substitution/rephrasing, added after live
  testing found `mistral-small-latest` otherwise reproduces (and
  compounds) a real meaning-altering failure mode also observed in
  `ovhcloud/gpt-oss-20b`. This is a real behavior change for the
  existing, already-shipped OpenRouter `spelling_grammar` preset too,
  not just new EdenAI code — see design.md's revision section.
- **Remove EdenAI's live catalogue entirely**: `getEdenAiCatalogue`,
  its two response normalizers, its cache, and the `provider=edenai`
  branch of `pages/api/models.js`. Nothing calls it once the admin panel
  no longer browses a catalogue; future model comparisons use direct API
  calls (`curl`), not an app feature.
- **Simplify `normalizeEdenAiConfig`**: drop `allowedModels`/
  `defaultModels` and their helpers; drop `validateEdenAiGovernanceConfig`
  entirely (nothing left to validate against an allowlist). `ttsVoices`
  stays — the user explicitly kept TTS voice as the one remaining
  user-editable choice, since it's a per-workspace preference, not a
  model-quality decision.
- **Simplify the admin routes and panel**: `activate.js` reads the
  model from `EDENAI_HARDCODED_MODEL[capability]` instead of an
  org-configured default, and returns `MODEL_NOT_YET_CONFIGURED` for a
  still-`null` capability; the pricing gate and live probe are
  unchanged. `EdenAiIntegrationPanel.js` shrinks to an API key field and
  one card per capability (label, status, read-only model name,
  activate button) — no catalogue fetch, no checkboxes, no dropdowns.
- **`resolveActiveProviderConfig`'s gating condition** changes from
  checking an org-configured `defaultModels[capability]` to checking the
  code-level `EDENAI_HARDCODED_MODEL[capability]` constant.

## Capabilities

### Modified Capabilities

- `edenai-provider`: "Live EdenAI Catalogue" requirement rewritten as
  "Hardcoded Per-Capability Model"; "EdenAI Grammar/Spell-Check Adapter"
  (added by `migrate-grammar-check-to-edenai`) removed.
- `model-governance`: "Dynamic Catalogue" requirement's EdenAI scenario
  removed — EdenAI is no longer a live-catalogue provider under this
  requirement (OpenRouter is unaffected).

## Impact

- Changed: `lib/edenai.js`, `lib/edenai-service.js`, `lib/edenai-pricing.js`,
  `lib/ai-provider-router.js`, `pages/api/organizations/integrations/edenai.js`,
  `pages/api/organizations/integrations/edenai/activate.js`,
  `pages/api/organizations/integrations/edenai/test.js`,
  `pages/api/models.js`, `components/settings/EdenAiIntegrationPanel.js`,
  `pages/api/text-optimization.js`, `lib/ai-service.js` (one sentence
  added to `optimizeText`'s `spelling_grammar` instruction — see the
  design.md revision section; this is the one change here that also
  affects OpenRouter-routed requests, not just EdenAI)
- Removed: `lib/edenai.js`'s catalogue-fetching code and cache,
  `checkGrammarEdenAi`, `tests/edenai-grammar.test.mjs`
- Unaffected: every other already-implemented Foundation piece
  (`resolveEdenAiConfig`, `edenAiJsonRequest`, `submitEdenAiAsyncJob`/
  `pollEdenAiAsyncJob`, `probeEdenAiCapability`, the pricing gate itself,
  `activatedCapabilities` semantics)
