# Design: Migrate Translation To EdenAI

## Call Sites

Three call sites currently pass `provider:'openrouter'` into
`executeReservedSpend` for a translation-shaped operation; two are in
scope here:

1. `pages/api/translate.js`'s `translate: async (maskedText, {...}) => {...}`
   closure — the single inline-text-translation call site.
2. `pages/api/translate/file.js`'s `translateSegmentsWithGlossary()` — one
   shared helper reused by the office-document (`office_translation`),
   PDF-in-place (`translation`), and scanned-PDF-OCR-fallback
   (`translation`) paths. One edit fixes all three.

Both replace their hardcoded `provider:'openrouter'` with the result of
`resolveActiveProviderConfig({userId, organizationId, capability:'chat'})`
(not `capability:'translation'` — see "Why Chat, Not a Dedicated
Capability" below) and branch to `translateText`/`translateTextSegments`
(ai-service.js) or `translateTextEdenAi`/`translateTextSegmentsEdenAi`
(edenai-service.js) accordingly.

`pages/api/translate/file.js` also resolves OpenRouter directly and
independently for its scanned-PDF OCR fallback step (`performOCR`) — OCR
is not migrated by this change, so that resolution stays as-is regardless
of which provider translation itself uses.

`lib/vexa-bridge.js`'s `runTranslationDelta()` (two further
`provider:'openrouter'` sites) is deliberately **not** touched here — see
proposal.md's Why. It moves with the Live-Meeting-STT change.

## Live Evidence: Dedicated MT vs. Chat (2026-08-28)

This change was originally scoped around EdenAI's dedicated
`translation/automatic_translation` feature (DeepL/Google/Amazon/
Microsoft/ModernMT). Two rounds of live testing against a production key
reversed that decision.

### Round 1 — schema check

`GET /v3/info/translation/automatic_translation` returns:

```json
{"input_schema":{"fields":[
  {"name":"text","required":true,"type":"string"},
  {"name":"target_language","required":true,"type":"string"},
  {"name":"source_language","required":false,"type":"string"}
]}}
```

No prompt/instruction field, no glossary-id or tag-handling passthrough.
This settles the master plan's previously-open question ("Ob DeepLs
natives Glossar über EdenAIs Aggregations-Layer erreichbar ist... ist
nicht verifiziert") — it is not, at least not through this documented
schema. The masking-guard architecture this app depends on
(`lib/translation-glossary.js`'s `glossaryBlock`/
`STRICT_PLACEHOLDER_INSTRUCTION`) has no channel to reach a dedicated MT
engine.

### Round 2 — does it matter in practice anyway?

Placeholder preservation turned out to work regardless — every engine
tested (deepl/google/amazon/microsoft/modernmt) preserved a masked
`DNTX0X…XTDN`/`TRMX0X…XMRT` token verbatim, including inside markdown
bold (`**TRMX...XMRT**`), across a simple DE↔EN business text. So the
schema gap alone would not have been disqualifying if quality had been
otherwise flawless. It was not, on a harder stress test (colloquial
register, an idiom, markdown headers, numbers/currency):

| Provider | Defect found | Reproducible? |
|---|---|---|
| Google | Injected a spurious ` ``` ` code-fence at the end of the response | Yes — identical on rerun |
| ModernMT | Split `**TRMX...XMRT**` into `** TRMX...XMRT * *` (broke markdown bold); mistranslated "board" (company board of directors) as "Tafel" (chalkboard) | Not rerun — both are structural/semantic, not sampling |
| DeepL | Mixed formal/informal address (Sie/du) within one response | Not rerun (deterministic engine) |
| Amazon | Same Sie/du mix, plus a lowercased markdown heading (`## protocol`) | Not rerun (deterministic engine) |
| Microsoft | None found | Rerun once, byte-identical |
| **`chat`/`mistral-small-latest`** (existing hardcoded chat model, unmodified `translateText`-style prompt) | **None found** — also the only candidate to correctly translate "## Minutes" → "## Protokoll" (every dedicated engine, both directions, got this idiom wrong) | — |

Additionally verified `chat`'s strict-JSON segment-translation mode (the
shape `translateTextSegments`/`pages/api/translate/file.js` need for
office/PDF documents): a 4-segment and a 5-segment batch (including one
empty segment and one placeholder-only segment) both returned
well-formed, exact-length, correctly-ordered JSON, stable across 3
reruns each. This resolves the master plan's Risk #3 ("unbestätigtes
JSON-Mode-Zuverlässigkeit") for `mistral-small-latest` specifically.

Test texts, raw request/response JSON, and the full rerun log are not
committed to the repo (production-key test artifacts, deleted from the
local scratchpad after use per this project's key-handling practice) —
this table is the retained record.

### Why Chat, Not a Dedicated Capability

Given the evidence above, `translation` is not resurrected as its own
EdenAI capability with its own hardcoded model — it routes through
`chat`, exactly like `spelling_grammar` already does (see
`hardcode-edenai-models`). Concretely:

- `lib/edenai.js`'s `EDENAI_CAPABILITIES`/`EDENAI_CAPABILITY_MODEL_SHAPE`/
  `EDENAI_HARDCODED_MODEL` lose their `translation` entry entirely (five
  capabilities, not six).
- `lib/edenai-pricing.js`'s `EDENAI_OPERATIONS.chat` gains
  `translation`/`office_translation`/`live_translation` (moved from the
  now-deleted `EDENAI_OPERATIONS.translation`) — mirrors
  `lib/openrouter-pricing.js`'s `chat` operations list, which already
  groups translation the same way for OpenRouter.
- The EdenAI settings panel shows no "Übersetzung" capability card;
  translation becomes usable the moment `chat` is activated, with no
  separate activation step, probe, or pricing gate of its own beyond
  `chat`'s existing ones.

## What Stays Untouched

`lib/translation-glossary.js`'s `translateTextWithGlossaryGuard`/
`translateSegmentsWithGlossaryGuard` take an injected `translate`/
`translateSegments` callback and contain no provider-specific logic —
zero changes. Same for `lib/office-translation.js`'s
`translateOfficeDocumentBuffer({translator, ...})` and
`lib/pdf-inplace.js`'s extraction/redraw pipeline. Translation-memory
lookup/storage (`lookupTMMatchesBatch`/`storeTM`) is also unchanged and
provider-agnostic already.

This means: the masking of do-not-translate/glossary terms into
`DNTX{n}X{hash}XTDN`/`TRMX{n}X{hash}XMRT` placeholders, the post-call
verification that every placeholder survived, and the fail-safe-to-source
behavior on a dropped placeholder all continue to run exactly as they do
today, regardless of which provider actually performed the translation.

## `translateTextEdenAi` / `translateTextSegmentsEdenAi`

Call EdenAI's `/chat/completions` with the hardcoded `chat` model
(`EDENAI_HARDCODED_MODEL.chat`), using the exact same system-prompt shape
`lib/ai-service.js`'s `translateText`/`translateTextSegments` already use
(structural-preservation rules, the same
`STRICT_PLACEHOLDER_INSTRUCTION`). Return shape matches those functions
exactly: `{translatedText, usage, model, providerRequestId}` and
`{translations, usage, model, providerRequestId}` respectively, so the
glossary-guard layer above needs no changes to consume either.

## Native Document Translation — Deliberately Not Adopted

EdenAI/DeepL/Google/Microsoft all offer native Document Translation
(upload a binary Word/PDF, receive a translated file with layout
preserved) as a first-class product — more capable for binary formats
than anything the current chat-completion-based approach can do. This
change does not adopt it:

- The existing `translator()`/`translateSegmentsWithGlossary()` seam is a
  smaller, lower-risk change than replacing the whole extraction/
  reassembly pipeline.
- Native document translation would bypass this app's own glossary/
  translation-memory/quality-guard machinery entirely — and, per the
  schema check above, has no confirmed glossary passthrough anyway.
- It would also bypass the GxP-relevant layout report `lib/pdf-inplace.js`
  already produces (which segment moved, what was redacted, what
  overflowed) — a diagnostic EdenAI's document-translation response has
  no equivalent for.

Recorded as a possible separate, later product decision if the local
pipeline's translation fidelity turns out to be the limiting factor.

## Risks / Trade-offs

- Cost-doubling on a dropped placeholder is unchanged by this migration —
  it is a property of the masking-guard *retry* policy, not of which
  provider is called. `chat`'s live-tested reliability (above) reduces
  how often this actually triggers, but does not eliminate the
  possibility.
- `pages/api/translate/file.js`'s `translateSegmentsWithGlossary()` is a
  single shared helper across three operations with two different price
  rows (`translation`, `office_translation`) — both now live under
  `chat`'s existing `EDENAI_OPERATIONS` entry, so no separate pricing
  pre-flight is needed beyond what `chat` activation already requires.
- The stress-test evidence above is a snapshot from one live comparison
  round, not an exhaustive audit of every language pair or MT provider
  version — if EdenAI's dedicated engines improve their instruction/
  glossary support later, this decision is worth revisiting, but not
  before then.
