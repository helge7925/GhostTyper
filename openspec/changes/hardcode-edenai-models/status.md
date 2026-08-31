# Status: Hardcode EdenAI Models

Last updated: 2026-08-28

## Current State

- **Planned.** No tasks started. Triggered by `migrate-grammar-check-to-edenai`'s
  own production-key verification (its task 7.1): a real head-to-head
  comparison found EdenAI's dedicated `text/spell_check` feature
  underperforms EdenAI's own `chat` capability for German
  grammar/spelling correction, contradicting that change's founding
  assumption. This prompted a broader, user-directed design change: no
  more catalogue-driven model selection for any EdenAI capability —
  every capability gets exactly one hardcoded model, chosen through a
  real comparison test, one capability at a time. See design.md for the
  full evidence table and architecture.
- `chat: 'mistral/mistral-small-latest'` is the first (and only, so far)
  capability decided — revised the same day from an initial
  `anthropic/claude-sonnet-5` decision once the user weighed in on cost
  and required an open-weight model from a European provider; see the
  dated entry below. `translation`/`ocr`/`transcription`/
  `liveTranscription`/`tts` are architected but left unusable
  (`MODEL_NOT_YET_CONFIGURED`) until each gets its own comparison pass —
  explicitly deferred, not forgotten; see the master plan file's
  "Design-Philosophie-Korrektur" section for the standing process.
- Supersedes `migrate-grammar-check-to-edenai`'s `grammar` capability
  entirely (that change's status.md is being marked superseded, pointing
  here, not deleted — its three-test evidence is the factual basis for
  this change's chat model decision).

## Implementation (2026-08-28)

All 7 task groups done in one pass:

- `grammar` capability removed everywhere (`lib/edenai.js`,
  `lib/edenai-service.js`'s `checkGrammarEdenAi`, `lib/edenai-pricing.js`,
  `activate.js`'s `probeInputFor`, the admin panel, all its tests).
- `EDENAI_HARDCODED_MODEL` added; `chat: 'anthropic/claude-sonnet-5'`
  decided, the other five `null`. Live catalogue code (`getEdenAiCatalogue`
  + both normalizers + the cache + `resolveConfiguredEdenAiModel`)
  removed from `lib/edenai.js` entirely, along with
  `validateEdenAiGovernanceConfig` and the `allowedModels`/`defaultModels`
  fields in `normalizeEdenAiConfig`.
- New `optimizeTextEdenAi` in `lib/edenai-service.js`, byte-for-byte
  mirroring `optimizeText`'s preset instructions and return contract.
  `pages/api/text-optimization.js` now resolves `chat` uniformly for all
  six presets — the preset-conditional branch is gone.
- Admin routes simplified: `activate.js` reads the hardcoded model and
  returns `MODEL_NOT_YET_CONFIGURED` for a `null` capability;
  `edenai.js`'s PUT only accepts `apiKey`/`ttsVoices`; `test.js` is now
  a single lightweight `GET /v3/info` connectivity check;
  `pages/api/models.js`'s EdenAI branch removed entirely.
- `EdenAiIntegrationPanel.js` rewritten: no catalogue fetch, no
  checkboxes, no dropdowns — a read-only hardcoded-model line per
  capability card, TTS voice input preserved.
- Tests updated throughout (`tests/edenai.test.mjs`,
  `tests/edenai-secrets.test.mjs`, `tests/ai-provider-router.test.mjs`),
  `tests/edenai-grammar.test.mjs` deleted, new
  `tests/edenai-optimize-text.test.mjs` (6 tests) for the new adapter.
  `npm test` → 434 tests / 422 pass / 12 skipped / 0 failed. Lint clean.
- Manual verification (7.2/7.3) against an isolated throwaway
  environment, real production EdenAI key: confirmed unconfigured orgs
  still fall through to OpenRouter unchanged; confirmed
  `MODEL_NOT_YET_CONFIGURED` for an undecided capability;
  confirmed the full real activation flow (pricing gate → price rows →
  real live probe, `probed:true`) and a real ~2.8s round trip to EdenAI
  for a `spelling_grammar` request (confirmed via server timing and a
  real budget reservation row) — full details in tasks.md's 7.2/7.3
  entries, including the one caveat found (a budget-commit-worker timing
  gap specific to the minimal hand-seeded test org, not a defect in this
  change).
- `openspec validate hardcode-edenai-models --strict` passes.

## Chat model revision: cost + European open-weight requirement (2026-08-28, same day)

The user rejected `claude-sonnet-5` on cost after the initial decision
above and asked for an open-weight model from a European provider
specifically — a standing constraint, not a one-off preference. Explored
EdenAI's real chat catalogue (990 models, re-fetched with the production
key) for European-origin open-weight candidates; `mistral/mistral-small-latest`
(Mistral AI, France, Apache-2.0) was the clear best fit — a current,
actively-maintained 24B general-purpose model, ~1/13th of Sonnet 5's cost.

Live-tested it against the same three German texts, unchanged prompt:
matched Sonnet 5 on the two clean tests, but reproduced `gpt-oss-20b`'s
exact `also`→`Auch` meaning-altering error on the colloquial stress
test — *and* added two more unforced synonym substitutions in the same
response (`sagen`→`mitteilen`, `heisst`→`bedeutet`). Worse than
`gpt-oss-20b`, not better. Rather than discard the candidate, tested
whether the *prompt* was the fixable part: added one explicit
anti-paraphrasing sentence to `spelling_grammar`'s instruction, re-ran
all three tests — the stress test now matches Sonnet 5's output almost
verbatim, no under-correction on the other two.

Per the user's explicit choice (asked directly, not assumed), this
prompt addition was applied to **both** `lib/ai-service.js`'s
`optimizeText` (OpenRouter, already in production) and
`lib/edenai-service.js`'s `optimizeTextEdenAi` — keeping them in sync,
since the fix is a genuine quality improvement independent of provider,
not an EdenAI-specific workaround. This is the one part of this change
that affects already-shipped OpenRouter behavior, not just new EdenAI
code — flagged explicitly since it wasn't asked for on its own, only as
a consequence of finding the cheaper EdenAI candidate.

`EDENAI_HARDCODED_MODEL.chat` is now `'mistral/mistral-small-latest'`.
All EdenAI-side and OpenRouter-side tests, the design.md/proposal.md
evidence sections, and code comments were updated to match. Full
transcripts and reasoning in design.md's "Revision: Cost + European
Open-Weight Requirement" section. `npm test` (434/422/12/0) and
`openspec validate --strict` both still pass after the change.

## Prompt hardening: harder stress tests, two languages (2026-08-28, same day, second round)

The user asked for further, harder stress testing until the result was
genuinely reliable — no rephrasing, only real grammar/punctuation fixes —
explicitly required to hold in more than one language. Two new tests
(a harder German text mixing real errors with informal contractions
like `Ich hab`, and a parallel English text with filler words, missing
apostrophes, and a genuine homophone error `too`/`to`) surfaced two more
real issues beyond the first revision's fix, both found and fixed the
same session:

1. `Ich hab` was being expanded to `Ich habe` — an unwanted formality
   change. Fixed with an explicit "don't expand informal contractions"
   instruction.
2. That fix over-generalized: the model stopped capitalizing
   sentence-initial filler words entirely (confirmed reproducible across
   3 immediate reruns, not a fluke). Fixed with an explicit carve-out:
   capitalization/spelling rules still apply to informal words; only
   their word choice and formality must stay unchanged.

Verified the final combined instruction against all 5 test texts
(3 German, 2 English), then reran the two previously-problematic ones
3 more times each (6 additional live calls) — stable, correct on every
run. This final instruction now ships in both `optimizeText`
(`lib/ai-service.js`, OpenRouter) and `optimizeTextEdenAi`
(`lib/edenai-service.js`) — full three-failure-mode history in each
file's code comment and in design.md's "Second Revision" section.
English was verified alongside German because it's GhostTyper's other
real supported language (the meeting-bot's language selector offers
only Deutsch/English/automatic detection) — no other language was
tested, and that's flagged explicitly rather than assumed to generalize.

`npm test` (434/422/12/0) and `openspec validate --strict` both still
pass after this second round.

## Presets restricted to `spelling_grammar` only (2026-08-28, same day, third round)

`pages/textoptimierung.js`'s tool was originally built as general text
*reformulation* (six presets: spelling_grammar, friendlier, more_formal,
shorter, clearer, email_improve), not just correction. Only
`spelling_grammar` has been through the stress-testing/prompt-hardening
rounds above — the other five are genuine LLM rewrites whose quality
with `mistral-small-latest` (or any hardcoded model) has never been
checked. The user's standing principle from this point on: only ship a
preset once it's verified with the same rigor, nothing before.

`ALLOWED_PRESETS` (`pages/api/text-optimization.js`) and `PRESETS`
(`pages/textoptimierung.js`) both reduced to `spelling_grammar` only —
the other five are disabled everywhere (API rejects them, UI doesn't
show them), regardless of provider; this isn't an EdenAI-specific
restriction, it's a general "not verified enough to ship right now"
gate. Default `preset` value in the API changed from `'clearer'` (now
disabled) to `'spelling_grammar'`. Nothing was deleted — the other five
presets' instruction text still lives in both `optimizeText`'s and
`optimizeTextEdenAi`'s `presetInstructions` maps, ready to re-enable
once each is individually verified. Verified visually in a browser
(isolated throwaway environment, same pattern as before): the preset
picker now shows exactly one button, pre-selected. `npm test`
(434/422/12/0) and lint both still pass.

## Outstanding

- The five still-undecided EdenAI capabilities' model choices are out of
  scope for this change by design — each becomes its own small
  follow-up once needed (translation is next in the master plan's phase
  order).
- The five disabled text-optimization presets (friendlier, more_formal,
  shorter, clearer, email_improve) need their own verification pass
  before re-enabling — not scoped to this change, flagged for whoever
  picks that up next.
- Nothing else — every task in `tasks.md` is done.
