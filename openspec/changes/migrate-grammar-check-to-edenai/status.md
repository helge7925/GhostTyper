# Status: Migrate Grammar/Spell Check To EdenAI

Last updated: 2026-08-28

## SUPERSEDED by `hardcode-edenai-models`

**This change's `grammar` capability is being removed from the
codebase, not kept.** Its own production-key verification below (task
7.1's head-to-head comparison) found EdenAI's dedicated `text/spell_check`
feature underperforms EdenAI's `chat` capability for German
grammar/spelling correction — the opposite of this change's founding
assumption. That finding, combined with a broader user-directed decision
to drop catalogue-based model selection everywhere in favor of hardcoded,
comparison-tested models per capability, is fully written up in
`../hardcode-edenai-models/`. This file is kept as-is (not deleted) —
the three real test transcripts and their results below are the factual
basis for `hardcode-edenai-models`' `chat: 'anthropic/claude-sonnet-5'`
decision, and the implementation history remains useful context for
anyone revisiting German-language grammar correction later.

## Current State (historical — describes the now-reverted implementation)

- **Implemented, all tasks in `tasks.md` complete** including 7.1
  (German correction quality on a real production key — result is mixed,
  see below, and needs a user decision on activation guidance, not more
  engineering). All code, tests, admin UI, and pricing runbook are in
  place; `npm test` and `openspec validate --strict` both pass. Raised
  from a user question
  about whether EdenAI's dedicated spell-check feature was already
  covered by the migration plan (it wasn't — `spelling_grammar` was
  lumped into the generic `text_optimization`→`chat` migration). Depends
  on `add-edenai-provider-foundation` (extended its `EDENAI_CAPABILITIES`
  list and reuses `resolveActiveProviderConfig`/`probeEdenAiCapability`/
  `getEdenAiCatalogue` as-is — no further Foundation changes needed
  beyond the capability-list extension this change itself makes).
  Independent of `migrate-chat-tts-and-decommission-openrouter` and every
  other migration change.
- **Product decision, confirmed before implementation started**: the
  user considered and explicitly chose *not* to build a new, separate
  "Proofread" feature — this change converts the existing
  `spelling_grammar` preset's backend instead (one UI entry point stays
  one UI entry point; only what runs behind it changes). This is exactly
  what the change was already designed to do, so no design rework was
  needed.

## Live verification against a real EdenAI sandbox account (2026-08-28)

Before any task in this change was implemented, the user provided a
sandboxed EdenAI dev key and asked to verify everything built so far —
including this change's still-unimplemented design. Ran real
`text/spell_check` requests against it (see
`add-edenai-provider-foundation/status.md`'s matching entry for the
account/method). Findings, all incorporated into `design.md`/
`proposal.md`/`tasks.md` before this note was written:

- **The documented output shape was wrong.** Real response:
  `output.items` (not `output.corrections`), each item's flagged span at
  `.text` (not `.original`), and the replacement inside a
  `.suggestions[]` array of `{suggestion, score}` (not a single
  `.suggestion` string) — `score` was `null` in every observed response,
  so it cannot be used for re-ranking. An item can have zero suggestions.
  The splice algorithm in design.md was rewritten around the real shape
  before any code was written against the old one — this bug never
  shipped.
- **Microsoft is not even a provider for this feature on the test
  account.** Real confirmed providers: `prowritingaid` ($10/1,000
  requests) and `sapling` ($2/million characters).
- **German-language go/no-go, half-resolved**: `sapling` accepts
  `language:"de"` with a real success response; `prowritingaid` actively
  rejects it with a real, server-enforced error
  (`"Provider does not support selected language: `de`"`). Both
  confirmed as genuine (not sandbox-faked) via a working negative
  control (an invalid language code produces a different real error).
  **This resolves whether German is accepted at all — it does not
  resolve correction quality**, since this sandbox key returns identical
  canned output content regardless of the real input text or language.
  Task 7.1 is narrowed accordingly: still gated on a real production
  key, now specifically for a quality check rather than a
  does-it-even-work check.
- Recommendation for `tasks.md`'s admin-facing work (4.1's panel copy,
  5.1's runbook): point DACH/German-language workspaces at `sapling`
  specifically; `prowritingaid` is English-only.

## Implementation (2026-08-28)

All 7 task groups done in one pass, immediately following the live
verification above (same day):

- **Group 1 (Foundation)**: `grammar` added to `EDENAI_CAPABILITIES`/
  `EDENAI_CAPABILITY_MODEL_SHAPE` in `lib/edenai.js`
  (`{category:'text', subfeature:'spell_check'}`); `grammar:
  ['grammar_check']` added to `lib/edenai-pricing.js`'s
  `EDENAI_OPERATIONS`; a new test confirms `getEdenAiCatalogue` hits the
  right URL for `grammar` using the real confirmed providers.
- **Group 2 (Adapter)**: `checkGrammarEdenAi` added to
  `lib/edenai-service.js` (previously an empty scaffold) — splices
  `output.items` in reverse-offset order using
  `suggestions[0]?.suggestion`, handles the confirmed
  `status:"fail"`/HTTP-200 failure shape explicitly (surfacing EdenAI's
  real `error.message`), and the overlapping-span guard. 9 tests in the
  new `tests/edenai-grammar.test.mjs`, including a manually-traced
  multi-correction reverse-offset case and an overlap case.
- **Group 3 (Call site)**: `pages/api/text-optimization.js` now branches
  on `resolveActiveProviderConfig({capability:'grammar'})` only for the
  `spelling_grammar` preset; every other preset's code path is
  byte-for-byte unchanged (still calls `resolveOpenRouterConfig`
  directly, never touches the router). `operation` is `grammar_check`
  only on the real EdenAI path; `text_optimization` everywhere else,
  including `spelling_grammar` falling back to OpenRouter when `grammar`
  isn't activated. Audit log metadata now also records `provider`.
- **Group 4 (Admin UI + a gap closed)**: `grammar` added to
  `EdenAiIntegrationPanel.js`'s `CAPABILITIES`/`LABELS`, plus a
  DACH-specific hint recommending `sapling` over `prowritingaid` for
  German workspaces. Also closed a design/tasks.md gap found while
  implementing this: design.md's Risks section always said this change
  would wire `grammar` into `activate.js`'s live activation probe, but
  no task ever existed for it — added task 4.2 and implemented it.
  `FOUNDATION_PROBE_INPUT` renamed to `STATIC_PROBE_INPUT`; a new
  `probeInputFor(capability, userId)` fetches the acting user's language
  setting (`getSettingsRow`, `'de'` fallback) for `grammar`'s probe,
  since unlike `tts`'s fixed payload, the whole point of this probe is
  to catch a provider/language mismatch at activation time.
- **Group 5 (Pricing)**: a "Pricing Runbook" section added to design.md
  with worked `inputPricePerMillionMicros` numbers for both real
  providers (`sapling`: 2,000,000; `prowritingaid`: 10,000,000,000),
  pointing at the Foundation change's general runbook for the process.
- **Group 6 (Tests)**: 6.1 done as part of Group 2 above. 6.2 (route-level
  preset→capability routing test) has the identical scope limitation as
  `add-edenai-provider-foundation`'s task 5.4 — no route-mocking infra
  exists anywhere in this suite, and the route's only untested surface is
  a single `if` around already-covered logic; verified by code review
  instead, documented in `tasks.md`.
- **Group 7 (Verification)**: 7.2 covered at the unit level (a live
  sandbox check wouldn't exercise the real empty-`items` path, since the
  sandbox key returns canned content regardless of input). 7.3 (`npm
  test`: 445/433/12/0) and 7.4 (`openspec validate --strict`) both pass.
  Lint clean throughout.

`npm run lint` clean; `npm test` → 445 tests / 433 pass / 12 skipped
(10 pre-existing + 2 DB-only) / 0 failed.

## Production-key German quality check (2026-08-28) — task 7.1

The user provided a real (non-sandbox) EdenAI production key
(`sk-eden-live-...`) specifically for this check — used only for two
direct `curl` calls, never committed, deleted from the local scratch
file immediately after. Confirmed genuinely live (not fixture data,
unlike the earlier sandbox key): `output.text` in both responses echoed
the exact real input, and `cost` varied per call (`0.000670000`/
`0.000260000`) proportional to input length.

**Test 1 — realistic meeting-note text** (capitalization errors, a
typo, and a `das`/`dass` mix-up — the error profile real ASR-transcribed
German meeting notes typically have):

> "Die besprechung am dienstag hat gezeigt das wir unsere Ziele für das
> nächste quartal anpassen müssen. Der Kunde hat uns mitgeteilt dass er
> mehr zeit für die Lieferung braucht. wir sollten den Zeitplan
> überarbeiten und die wichtigsten meilensteine neu definieren. Ich habe
> die aufgabe übernohmen den Bericht bis freitag fertigzustellen."

`sapling` returned exactly 2 items:
- `"Zeitplan"` (correctly spelled, correct capitalization) →
  suggested `"Zeitlang"` — **a false positive**; "Zeitlang" is not a
  sensible replacement in this context ("den Zeitplan überarbeiten" =
  "revise the schedule"; "den Zeitlang überarbeiten" is nonsensical).
  Applying `suggestions[0]` blindly here would have corrupted correct
  text.
- `"übernohmen"` (a real typo) → 4 suggestions:
  `["übernehmen", "übernommen", "übernahmen", "übernähmen"]`, all with
  `score: null`. The grammatically correct one in context ("Ich habe die
  Aufgabe **übernommen**" — perfect tense) is ranked **second**, not
  first — `checkGrammarEdenAi`'s `suggestions[0]` choice (per design.md,
  since `score` is never populated) would have produced
  "Ich habe die Aufgabe **übernehmen**", which is grammatically wrong.

**Not caught at all**: every one of the 8 deliberate German
noun/sentence-start capitalization errors in the test text
(besprechung, dienstag, quartal, zeit, wir, meilensteine, aufgabe,
freitag all left lowercase) and the incorrect `das` that should be
`dass` (subordinating conjunction). `text/spell_check` appears to be a
narrower spelling-only tool than its `subfeature_fullname: "Grammar
Spell Check"` label suggests — German capitalization and grammar-level
errors are outside what it actually checks, at least for `sapling`.

**Test 2 — pure spelling typos, no capitalization needed** (isolates
whether the gap above is "spell_check is weak" vs. "spell_check doesn't
do capitalization/grammar specifically"):

> "Der Termim für die nächste Sizung ist noch nicht bekannt. Wir müssen
> das Protokol schnell versenden und die Teilnehmer informiren."

`sapling` caught all 4 typos, each with exactly one, correct suggestion:
`Termim→Termin`, `Sizung→Sitzung`, `Protokol→Protokoll`,
`informiren→informieren`. No false positives, no ambiguity.

**Verdict — mixed, not a clean pass**: `sapling`'s pure-typo correction
for German is genuinely reliable (4/4, unambiguous). But it does **not**
catch German capitalization or `das`/`dass`-class grammar errors at
all — a real gap for GhostTyper's actual use case, since ASR-transcribed
German text very commonly has exactly those errors (most STT engines
don't capitalize German nouns correctly). It also produced one confirmed
false positive and one confirmed bad-ranking case in a small sample —
both are now *observed* failure modes, not theoretical ones, and both
directly validate the design's existing overlapping-span guard's
underlying caution (that blind auto-application of corrections is
risky) even though neither triggered that specific guard.

**Recommendation, not unilaterally decided here**: three real options,
flagged for the user —
1. Ship as-is, but disclose the limitation clearly in the admin panel
   (already has a `sapling` vs `prowritingaid` hint from task 4.1 — could
   extend it to note "corrects spelling only, not capitalization or
   grammar") and accept it as a narrower, but genuinely safe-for-spelling,
   tool.
2. Hold German-language activation guidance at "not recommended yet"
   given the capitalization gap covers the single most common German
   ASR-artifact class — keep German workspaces on the existing
   LLM/chat `spelling_grammar` path (which does handle capitalization,
   at the cost of the over-rewrite risk this whole change exists to
   avoid) until a provider with real German grammar+capitalization
   support appears in EdenAI's catalogue.
3. Ship it, but treat the false-positive/bad-ranking finding as reason
   to prioritize a "review before applying" UI (the `corrections` field
   in `checkGrammarEdenAi`'s return is already designed as a seam for
   this, per design.md) before recommending activation broadly, rather
   than relying on blind auto-apply.

## Head-to-head comparison against an EdenAI chat model (2026-08-28, same session, same production key)

The user asked to try "a different correction model." EdenAI's own
catalogue was re-checked with the production key first — confirms
`text/spell_check` genuinely has only `prowritingaid`/`sapling`, no
third provider hidden behind the live account (`GET
/v3/info/text/spell_check?format=simplified` and the full `GET
/v3/info` feature listing both re-fetched and checked: `text` has 6
subfeatures total — `ai_detection`, `moderation`, `spell_check`,
`topic_extraction`, `named_entity_recognition`, `plagia_detection` —
`spell_check` is the only grammar/spelling-relevant one, and its
`subfeature_fullname` really is "Grammar Spell Check", just narrower
in practice than that name implies, at least for German via `sapling`).

So instead, ran the exact same two test texts from the section above
through EdenAI's own chat completions endpoint
(`anthropic/claude-sonnet-5`, confirmed available on this account) using
the identical narrow correction prompt `lib/ai-service.js`'s existing
`optimizeText` already uses for the `spelling_grammar` preset
("Correct spelling, grammar, punctuation and obvious typos. Preserve
meaning and structure.") — i.e. exactly the LLM-based path this whole
change was designed to move *away* from, just reached via EdenAI's chat
instead of OpenRouter's.

**Result: both tests came back perfect.** Test 1 (the realistic
meeting-note text with capitalization errors, a typo, and a das/dass
mistake): all 8 capitalization errors fixed, `das`→`dass` fixed,
`übernohmen`→`übernommen` (the grammatically correct form —
`sapling`'s top-ranked suggestion had been the wrong one),
**"Zeitplan" left untouched** (no false positive, unlike `sapling`), and
two grammatically-required commas added (before the `dass`-clause and
before the extended infinitive clause) that weren't even part of the
deliberate error set — genuinely correct German grammar the dedicated
tool doesn't check for at all. No rewriting, no rephrasing, meaning and
structure fully preserved — the exact over-correction risk this change's
`proposal.md` cited as the reason to move away from LLM-based correction
did not materialize in either test. Test 2 (pure typos): also 4/4
correct, matching `sapling`'s result there. Cost: ~$0.0021 and ~$0.0009
respectively — roughly 3x `sapling`'s cost per call, still a fraction of
a cent in absolute terms.

**This meaningfully undercuts this change's own core premise for
German.** `proposal.md`'s "Why" section argues a dedicated feature beats
a general LLM for this narrow task, drawing the same analogy already
proven true for translation (DeepL). For German grammar/spelling
specifically, the opposite was observed here: the well-prompted LLM
route outperformed the dedicated `text/spell_check` tool substantially,
with no observed downside. This is one head-to-head test, not an
exhaustive study — but it's a real, concrete data point directly
contradicting the change's founding assumption for this language, and
should be weighed accordingly rather than treated as a minor caveat.

## Outstanding

- **Revised recommendation given the head-to-head result above**: for
  German-language workspaces specifically, the evidence now points
  toward *not* activating `grammar` at all and keeping `spelling_grammar`
  on the LLM/chat path (this matches the "Option 2" already listed
  above, now with much stronger support than when it was written).
  `sapling` may still be worth activating for English-language
  workspaces (not tested — `prowritingaid`'s English-only, `sapling`'s
  English quality is unverified either way) if a similar head-to-head
  there confirms it holds up. Still the user's call, not decided
  unilaterally here — this is a product/go-to-market decision, not a
  code defect, and no code is blocked either way; the adapter, routing,
  admin UI, and pricing are all implemented and correct regardless of
  which language/provider combination ends up recommended for
  activation.
- Every task in `tasks.md` is done.
