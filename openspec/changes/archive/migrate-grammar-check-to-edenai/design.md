# Design: Migrate Grammar/Spell Check To EdenAI

## Confirmed API Contract (Live-Verified 2026-08-28, Supersedes The Original Docs-Sourced Draft)

The original draft below was sourced from `edenai/docs`' `v3/llms.txt`
reference and got the output shape and the example provider both wrong.
Corrected against real requests against a real (sandboxed) EdenAI
account — see `add-edenai-provider-foundation/status.md`'s matching
2026-08-28 entry for the account/method used, and this change's own
status.md for the full finding:

```
Request:  POST /v3/universal-ai
          {"model": "text/spell_check/sapling",
           "input": {"text": "...", "language": "de"}}

Response: {"status": "success", "cost": "0.000114000", "provider": "sapling",
           "feature": "text", "subfeature": "spell_check",
           "output": {
             "text": "<echoed input, not a corrected rewrite>",
             "items": [
               {"text": "Hollo", "type": null, "offset": 0, "length": 5,
                "suggestions": [{"suggestion": "Hello", "score": null}]},
               ...
             ]
           },
           "error": null, "original_response": null}
```

Confirmed real, differing from the original draft in every field name:
the corrections array is `output.items`, not `output.corrections`; each
item's original flagged span is `.text`, not `.original`; the
replacement is `.suggestions[0].suggestion` — **an array of ranked
candidates, not a single string** (`prowritingaid` returned up to 5
suggestions per item in testing; `score` was `null` in every observed
response, so ranking cannot be assumed reliable — take `suggestions[0]`
as the best guess, but an item can have zero suggestions, which must be
handled as "cannot auto-correct this span" rather than crashing). No
`_async` suffix — this is a synchronous `/universal-ai` call, not a job
to submit-and-poll, confirmed. `output.text` echoes back something
(observed as an unrelated fixture value on this sandbox key, so its
exact real-account content is unconfirmed) — `checkGrammarEdenAi` should
build its own corrected string via the splice algorithm below rather
than trust `output.text` directly, since the schema does not document
what it contains precisely enough to rely on it.

**German-language support — go/no-go partially resolved**: of the two
providers confirmed on the test account (see "Confirmed Providers"
below), `sapling` accepts `language:"de"` (HTTP 200, `status:"success"`)
while `prowritingaid` actively rejects it (`status:"fail"`,
`error.message:"Provider does not support selected language: `de`"`) —
both **real, server-enforced** responses, confirmed via a working
negative control (an invalid language code like `"xx-not-a-real-lang"`
produces a different, also-real error). This resolves the
*language-is-accepted* half of task 7.1's go/no-go check for `sapling`.
It does **not** resolve the *correction quality* half — the sandbox key
returns identical canned output content regardless of input, so whether
`sapling`'s actual German corrections are any good is still unverified
and still needs a real production key and native-speaker review before
recommending activation to a German-language workspace.

## `checkGrammarEdenAi` — Splicing Corrections Into A Rewrite

`optimizeText()`'s existing contract is `{optimizedText: string, usage,
model, providerRequestId}` — a single corrected string, because every
other preset is a full LLM rewrite. `text/spell_check` returns discrete
`items` instead (real field names, confirmed live — see above).
`checkGrammarEdenAi` bridges the two:

1. Sort `output.items` by `offset` descending.
2. For each item, skip it (log a warning) if `item.suggestions` is empty
   or missing — there is nothing to splice in, and leaving the original
   text is safer than guessing. Otherwise take
   `item.suggestions[0].suggestion` (the first-ranked candidate; `score`
   is not reliably populated — see above — so no re-ranking is done).
3. Splice `text.slice(0, item.offset) + suggestion +
   text.slice(item.offset + item.length)` — applying in reverse-offset
   order means each splice doesn't invalidate the offsets of items still
   to apply (a forward pass would shift every subsequent offset by the
   original/suggestion length delta).
4. Return `{optimizedText: splicedText, corrections: output.items, usage: {inputQuantity: text.length, outputQuantity: 0}, model, providerRequestId}`
   — `corrections` (kept as this adapter's own external field name, even
   though the wire field is `items`, so `optimizeText()`'s callers see a
   stable name regardless of which EdenAI field name it came from) is
   additive to the existing contract: present, not currently consumed by
   the UI, but not discarded either — a natural seam for a future "review
   changes" UI without needing another API round-trip.

This is a **deterministic, auditable transformation**, not a second LLM
call — the accuracy ceiling is EdenAI's spell-check model itself, not an
LLM's interpretation of a "please only fix errors" instruction, which is
the whole point of adopting it.

## Call Site — Preset-Conditional Routing (A New Pattern)

Every other EdenAI migration change routes one whole `operation` (or a
small fixed set of them) to one capability, uniformly. This change
introduces the first **preset-conditional** capability choice within a
single route: `pages/api/text-optimization.js` resolves `capability:
'grammar'` only when `preset === 'spelling_grammar'`; the other five
presets keep resolving `capability: 'chat'` exactly as they do today
(OpenRouter until `migrate-chat-tts-and-decommission-openrouter` lands,
EdenAI chat after). Both branches still go through the same
`executeReservedSpend` wrapper and the same response shape
(`{optimizedText}`), so this is invisible to the frontend caller.

## `grammar_check` — A New, Distinct Operation

EdenAI's spell-check is billed by `cost` per call (confirmed field in the
response above) on a presumably character-or-request basis, structurally
different from the token-based pricing every other `chat`-capability
operation uses. Reusing the existing `text_optimization` operation string
for this preset's EdenAI path would conflate two different billing units
under one cost-tracking category. `grammar_check` is a new, separate
operation string, added to `lib/edenai-pricing.js`'s `EDENAI_OPERATIONS`
as `grammar: ['grammar_check']` — `text_optimization` remains exactly as
it is today for the other five presets and for `spelling_grammar` on
whichever workspace hasn't activated the `grammar` capability yet (which
still goes through the existing LLM-prompt path, unchanged).

## Pricing Runbook

Follows `add-edenai-provider-foundation/design.md`'s general "Manual
Pricing-Entry Runbook" exactly — the platform admin creates one
`(edenai, <model>, grammar_check)` row via `/admin/prices` before an org
admin's first activation attempt, or `activate.js` blocks it with
`PRICE_OVERRIDE_REQUIRED` (verified live end-to-end on 2026-08-28 for
the `tts` capability during that change's own final verification pass —
same code path, same behavior).

Concrete numbers for the two real confirmed providers (live-verified
2026-08-28, see status.md — check EdenAI's own dashboard for current
rates before creating a row, these are a point-in-time reference, not a
guarantee):

- `text/spell_check/sapling`: $2.00 per 1,000,000 characters →
  `inputUnit: 'character'`, `inputPricePerMillionMicros: 2000000`.
- `text/spell_check/prowritingaid`: $10.00 per 1,000 requests →
  `inputUnit: 'request'`, and since `provider_price_versions` prices per
  **million** units, that's `$10,000` per million requests →
  `inputPricePerMillionMicros: 10000000000`.

Both are single-price features (no separate input/output split
documented) — set `outputUnit` equal to `inputUnit` and
`outputPricePerMillionMicros: 0`, matching how the Foundation runbook's
TTS worked example and `normalizeCataloguePrice`'s OpenRouter TTS branch
both handle single-price features.

## Risks / Trade-offs

- **German support: language accepted, correction quality confirmed
  mixed — not a clean pass** — live-verified twice: 2026-08-28 against a
  sandboxed account confirmed `sapling` accepts `language:"de"` while
  `prowritingaid` actively rejects it; 2026-08-28 (same day, real
  production key) confirmed actual quality: `sapling`'s pure-typo
  correction for German is reliable (4/4 correct in one test, single
  unambiguous suggestion each), but it does **not** catch German
  noun/sentence-start capitalization errors at all (0/8 in a realistic
  meeting-note test — the single most common German ASR-transcription
  error class) or `das`/`dass`-class grammar errors, and produced one
  confirmed false positive (a correct word "corrected" to a nonsensical
  one) plus one case where the grammatically-correct candidate in
  `suggestions[]` was ranked second, not first. See status.md's full
  transcripts and the three-option activation-guidance recommendation
  this leaves for the user. `activate.js`'s per-capability probe (this
  change wired `grammar` into it — see "Admin UI" section — reusing the
  Foundation change's `probeEdenAiCapability` with an `input: {text:
  '...', language: <acting user's language>}` payload) still only checks
  connectivity/language-acceptance at activation time, not correction
  quality — that distinction is now empirically important, not just
  theoretical, given the quality gaps found above.
- **Confirmed providers on the test account**: `prowritingaid`
  (`text/spell_check/prowritingaid`, pricing $10 per 1,000 requests,
  English confirmed, German confirmed **unsupported**) and `sapling`
  (`text/spell_check/sapling`, pricing $2 per million characters,
  English and German both confirmed **supported**) — supersedes the
  original draft's single Microsoft example, which does not even appear
  as a provider for this feature on the test account. The admin's model
  allowlist is still driven by the live catalogue
  (`GET /v3/info/text/spell_check?format=simplified`), so this isn't
  hardcoded into the design either way — but the admin-facing
  documentation/recommendation (task 4.1's panel copy, the runbook) should
  point DACH workspaces at `sapling` specifically, now that there's a
  real basis for that recommendation rather than a guess.
- **`suggestions` is a ranked array with an unreliable `score`** — every
  observed response had `score: null` regardless of provider or
  suggestion count (`prowritingaid` returned up to 5 candidates per
  item). `checkGrammarEdenAi` takes `suggestions[0]` as EdenAI's own
  best guess rather than attempting its own re-ranking; an item with a
  genuinely empty `suggestions` array is a real, observed case
  (`type: null` was also seen, so `type` cannot be relied on for
  anything either) and must be skipped, not crash.
- **Splice correctness depends on non-overlapping, correctly-ordered
  offsets** — if EdenAI ever returns overlapping correction spans, a
  naive reverse-offset splice could produce corrupted text. Add a guard
  (`tasks.md`) that detects overlapping spans and falls back to leaving
  that specific span uncorrected (logged) rather than corrupting output.
