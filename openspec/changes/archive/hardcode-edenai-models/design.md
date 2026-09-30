# Design: Hardcode EdenAI Models

## Evidence: The Grammar Comparison That Triggered This Change

Three real requests, same production EdenAI key, same three German test
texts (full transcripts in `migrate-grammar-check-to-edenai/status.md`'s
2026-08-28 entries):

| Candidate | Clean typo test | Realistic meeting-note test | Colloquial stress test |
|---|---|---|---|
| `text/spell_check/sapling` | 4/4 correct | Missed all 8 capitalization errors + `das`/`dass`; 1 false positive (`Zeitplan`→`Zeitlang`); best candidate ranked 2nd for one real typo | not tested |
| EdenAI chat, `anthropic/claude-sonnet-5` | matches sapling | all fixed, zero false positives, two grammatically-correct commas added unprompted | all fixed, including a tricky filler word (`also`) kept correct — no meaning change |
| EdenAI chat, `ovhcloud/gpt-oss-20b` | matches sapling | matches Sonnet 5 | **one real meaning-altering error**: `also`→`Auch` (different word) |

Conclusions this change acts on:
1. The dedicated `text/spell_check` feature is not a safe default for
   German — it under-corrects (misses the single most common German
   ASR-artifact class) and can still produce false positives, so the
   "safer than an LLM" premise doesn't hold empirically.
2. A well-prompted large chat model (`claude-sonnet-5`) is safe: no
   over-rewriting observed in three varied tests, including the hardest
   one.
3. A cheap small model (`gpt-oss-20b`) is *not* safe for this task on
   its own evidence — one real content-altering error on exactly the
   style of text (colloquial, spoken) GhostTyper's real transcriptions
   look like. Cost difference (~$0.002 vs ~$0.0001 per call) is
   negligible in absolute terms next to that risk.

`chat: 'anthropic/claude-sonnet-5'` was decided on this basis initially —
**revised the same day** (below) once the user weighed in on cost and
sovereignty. The other five capabilities (`translation`, `ocr`,
`transcription`, `liveTranscription`, `tts`) have not been through this
process yet — `EDENAI_HARDCODED_MODEL` carries `null` for them, and
`activate.js` refuses to activate a `null` capability. Each gets its own
comparison pass later, using the same method (real production key,
multiple candidates, realistic test inputs, direct `curl` — no app
feature needed to do this).

## Revision: Cost + European Open-Weight Requirement (same day, 2026-08-28)

`claude-sonnet-5` passed every test above cleanly, but the user rejected
it on cost and asked specifically for an open-weight model from a
European provider — a real, standing constraint, not just a
cost-optimization preference. `mistral/mistral-small-latest`
(Mistral AI, France; Apache-2.0 licensed, genuinely open-weight; ~1/13th
of Sonnet 5's per-token cost) was the strongest catalogue match.

Tested it against the same three texts with the *unchanged* prompt: the
clean typo test and the realistic meeting-note test both matched
Sonnet 5's quality exactly. The colloquial stress test did not —
`mistral-small-latest` reproduced `gpt-oss-20b`'s exact failure
(`also`→`Auch`, a real meaning change) **and added two more unforced
synonym substitutions** the same run: `sagen`→`mitteilen` and
`heisst`→`bedeutet` (a spelling-only fix would have been `heißt`).
Worse than `gpt-oss-20b`, not better — cheaper/smaller models drifting
toward paraphrasing on messy, colloquial text is apparently a real,
repeatable failure mode across vendors, not a one-off quirk of one
model.

Rather than discard the candidate, tested whether the *prompt* — not the
model — was the fixable part. Added one sentence to the
`spelling_grammar` preset instruction, explicit about the failure mode
observed:

> Do not rephrase, reword, or substitute words with synonyms — only fix
> actual errors, and keep every correctly-used word exactly as written,
> including colloquial or informal words like filler words at the start
> of a sentence.

Re-ran all three tests with this addition: the stress test came back
matching Sonnet 5's output almost verbatim (`also` kept as `also`,
`sagen` kept as `sagen`, `heisst`→`heißt` only), and the two already-passing
tests stayed fully correct — no under-correction regression. This
sentence is now part of `spelling_grammar`'s instruction in **both**
`lib/ai-service.js`'s `optimizeText` and `lib/edenai-service.js`'s
`optimizeTextEdenAi` (kept identical on purpose, per the user's explicit
choice to keep the two adapters in sync rather than let them diverge —
it's a general quality improvement, not an EdenAI-specific workaround,
so OpenRouter-routed `spelling_grammar` requests get it too).

**`gpt-oss-20b` was not retried with the tightened prompt** — it was
already ruled out by the European-open-weight requirement regardless of
whether the prompt fix would have saved it too (OVHcloud, its host, is
French, but the model itself — OpenAI's `gpt-oss` release — is not of
European origin; the user's ask was read as requiring the model, not
just the hosting infrastructure, to be European).

## Second Revision: Harder Stress Tests, Two Languages, Final Prompt (same day, 2026-08-28)

The user asked for further, harder stress testing until the result was
"wirklich perfekt" — no rephrasing, only grammar/punctuation correction —
and explicitly required this to hold in other languages too, not just
German. Two new test texts, deliberately harder than the first three:

- **German, Test 4**: mixes real errors (missing capitalization ×2, a
  missing dative case ending `dem Kunde`→`dem Kunden`, missing commas)
  with informal filler words (`ja`, `also`) and — new — an informal verb
  contraction (`Ich hab` instead of `Ich habe`), appearing twice with
  `nich` (colloquial for `nicht`) mixed in too.
- **English, Test 5**: parallel construction — a filler word (`like`),
  missing apostrophes (`wasnt`/`didnt`/`havent`), missing sentence
  capitalization, and a genuine homophone error (`too`→`to`).

Run against the prompt from the first revision (above): the English test
came back **flawless** — every real error fixed (`too`→`to` included),
`like` preserved and correctly capitalized/punctuated as a parenthetical
filler, no rephrasing. The German Test 4 found one new, real problem:
**`Ich hab` was expanded to `Ich habe`** — not a meaning change like
`also`→`Auch`, but still an unwanted intervention (a register/formality
change the writer didn't ask for; `nich`→`nicht` in the same response
was judged a legitimate spelling fix, not over-correction, and left as
evidence rather than treated as a bug).

Added a second instruction addressing this specifically: don't expand
informal contractions/shortened word forms into fuller, more formal
equivalents. Re-tested — fixed `Ich hab` on German Test 4, but broke
something unrelated: German Test 3 (from the first revision, previously
passing) stopped capitalizing sentence-initial filler words (`also`,
`die Kollegin`) entirely. **Confirmed reproducible, not a sampling fluke**
— identical wrong output across 3 immediate reruns. The model had
over-generalized "keep informal words as written" into "don't touch
informal words at all, including their capitalization."

Final fix: added an explicit carve-out clarifying that capitalization
and spelling rules still apply to informal/filler words — only their
word choice and formality level must stay unchanged, not their
mechanical correctness. Re-tested all 5 texts together, then reran the
two previously-problematic ones (German Tests 3 and 4) 3 more times each
(6 additional live calls) to confirm stability before trusting it:
**all 5 texts correct on every run, no exceptions.** This is the
instruction now shipped in both `optimizeText` and `optimizeTextEdenAi`
(see each file's own code comment for the full three-failure-mode
history). Not retested beyond German/English — GhostTyper's actual
supported languages today (the meeting-bot's language selector offers
only Deutsch/English/automatic detection) — so this instruction's
behavior in other languages remains unverified, flagged for whoever
adds support for a third language rather than assumed to generalize
automatically.

## `EDENAI_HARDCODED_MODEL`

```js
// lib/edenai.js
export const EDENAI_HARDCODED_MODEL = Object.freeze({
  chat: 'mistral/mistral-small-latest',
  translation: null,
  ocr: null,
  transcription: null,
  liveTranscription: null,
  tts: null,
});
```

A capability with `null` here cannot be activated
(`MODEL_NOT_YET_CONFIGURED`) — this is a deliberate fail-closed default,
matching the existing "no automatic cross-provider fallback" posture
`lib/ai-provider-router.js` already documents. `resolveActiveProviderConfig`'s
EdenAI branch requires `EDENAI_HARDCODED_MODEL[capability]` to be
truthy, replacing the previous `edenai.defaultModels[capability]` check.

## `optimizeTextEdenAi` — EdenAI's Chat Completion For Text Presets

New export in `lib/edenai-service.js`, structurally identical to
`lib/ai-service.js`'s `optimizeText` (same `presetInstructions` map —
including `spelling_grammar`'s existing "Correct spelling, grammar,
punctuation and obvious typos. Preserve meaning and structure." prompt,
unchanged, since it's exactly the prompt the comparison test above used
and validated) — only the transport differs: `edenAiJsonRequest('/chat/completions',
{model, messages: [...]}, apiKey, options)` instead of OpenRouter's
`aiJsonRequest`. Returns the same `{optimizedText, usage, model,
providerRequestId}` shape, so `text-optimization.js` branches on
`result.provider` exactly the way it already does for the grammar
capability today (that branching code doesn't need to change shape,
only which function each side calls).

## `text-optimization.js` — All Six Presets, One Capability

Every preset resolves `resolveActiveProviderConfig({capability:'chat'})`
now, not just `spelling_grammar`. The `else` branch that previously
called `resolveOpenRouterConfig` directly and bypassed the router for
the other five presets is removed — there's no longer a reason for that
special case, since `chat`'s EdenAI branch is fail-closed on
`EDENAI_HARDCODED_MODEL.chat` being unset, exactly like every other
capability. Until this change's chat model decision lands (this
change), and until any org has actually activated EdenAI's `chat`
capability, the router still falls back to OpenRouter for every preset —
this is not a behavior change for orgs that haven't touched EdenAI, only
a routing-code simplification.

## Simplified Activation Flow

`activate.js` no longer needs `getEdenAiCatalogue`/`availableIds.has(defaultModel)` —
the model comes from a code constant, already known correct by
construction (a developer chose it after testing, not an admin picking
from a live list). New flow: read `EDENAI_HARDCODED_MODEL[capability]` →
`400 MODEL_NOT_YET_CONFIGURED` if `null` → pricing gate
(`findMissingEdenAiPrices`, unchanged) → live probe
(`probeEdenAiCapability`, unchanged, `probeInputFor`'s `grammar` branch
removed since that capability no longer exists) → set
`activatedCapabilities`. The pricing gate still matters even with one
fixed model — a platform admin still creates exactly one
`(edenai, <model>, <operation>)` row, once, before any org can activate
that capability; this is unchanged in spirit, just no longer keyed off
an admin-chosen model.

## `EdenAiIntegrationPanel.js` — What Stays, What Goes

Stays: API key field + save, per-capability card with label and
"Aktiviert"/"Nicht aktiviert" badge, activate button, TTS voice text
input (explicit user decision — voice is a workspace preference, not a
quality decision the team needs to pre-vet the way a base model is).

Goes: the "Verbindung testen und Modelle laden" catalogue fetch loop,
every per-capability checkbox allowlist, every per-capability default-model
dropdown. Replaced with a single read-only line per card: the hardcoded
model name, or "Modell noch nicht festgelegt" (and a disabled activate
button) for the five still-`null` capabilities.

## Risks / Trade-offs

- **Five capabilities are architecturally ready but not usable** until
  their own comparison test lands — this is intentional (the user chose
  "architecture first, models one at a time" over "decide all seven
  before writing code"), not a gap in this change. `activate.js`'s
  `MODEL_NOT_YET_CONFIGURED` makes this state explicit and safe (fails
  closed, not silently) rather than allowing activation with an unvetted
  guess.
- **One comparison test per capability is not exhaustive** — grammar's
  own test used 3 texts and 2 candidate models; future capability
  comparisons should use a similarly real, varied test set (not a single
  clean example) given the `gpt-oss-20b` finding that clean-text
  performance didn't predict messy-text safety.
- **No more per-org model customization at all** — a workspace that
  specifically wanted a different EdenAI chat model (e.g., for cost or
  latency reasons) can no longer choose one. This is the explicit
  trade-off the user chose in exchange for zero end-user complexity;
  documented here so it isn't rediscovered as a surprise later.
- **`migrate-grammar-check-to-edenai`'s already-implemented, tested,
  production-key-verified code is being deleted**, not archived as dead
  code — its OpenSpec change stays in the repo marked superseded (not
  removed), so the reasoning and the three-test evidence that justified
  this reversal remain visible.
