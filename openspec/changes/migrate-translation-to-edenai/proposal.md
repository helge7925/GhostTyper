# Change: Migrate Translation To EdenAI

## Why

`lib/translation-glossary.js` masks protected terms as placeholder tokens
before every LLM translation call and, if even one placeholder is missing
from the model's output, discards the entire translation and retries once
with a stricter prompt. This guard is the mechanism that keeps
do-not-translate terms and glossary entries intact — a hard product
requirement, not a nice-to-have.

This proposal originally assumed EdenAI's dedicated MT engines (DeepL,
Google Cloud Translation, Amazon Translate, Microsoft, ModernMT) would be
the better fit, the same way a dedicated OCR/STT product beats a
general-purpose LLM elsewhere in this migration. Live testing against a
production EdenAI key (2026-08-28, see design.md) found the opposite for
this specific capability, for two independent reasons:

1. **Structural incompatibility.** `GET /v3/info/translation/
   automatic_translation` confirms the dedicated feature's input schema
   is exactly `{text, target_language, source_language}` — no
   prompt/instruction field, no glossary passthrough. The
   masking-guard architecture (`glossaryBlock`, the strict-placeholder
   retry) has no channel to reach a dedicated MT engine at all.
2. **Real defects, even setting (1) aside.** A harder stress test (mixed
   register, markdown, an idiom, embedded placeholder tokens) surfaced a
   reproducible spurious code-fence artifact from Google, broken
   markdown-bold syntax plus a real mistranslation ("board"→"Tafel")
   from ModernMT, and inconsistent Sie/du register within a single
   response from both DeepL and Amazon. `chat`/`mistral-small-latest`
   (already hardcoded for `spelling_grammar`, see
   `hardcode-edenai-models`) had none of these defects and correctly
   resolved one idiom ("Minutes"→"Protokoll") every dedicated engine got
   wrong.

Translation therefore routes through the `chat` capability — exactly the
same architecture this app now uses for grammar/spelling and general text
optimization, not a dedicated EdenAI product. There is no separate
`translation` capability to activate.

## What Changes

- `lib/edenai-service.js` gains `translateTextEdenAi`/
  `translateTextSegmentsEdenAi`, mirroring `lib/ai-service.js`'s
  `translateText`/`translateTextSegments` exactly (same prompt shape,
  same return contract), calling EdenAI's `/chat/completions` with the
  hardcoded `chat` model instead of a dedicated translation endpoint.
- `pages/api/translate.js`'s inline-translation call site and
  `pages/api/translate/file.js`'s shared `translateSegmentsWithGlossary()`
  helper (used by the office-document, PDF-in-place and scanned-PDF-OCR-
  fallback translation paths) resolve their provider via
  `resolveActiveProviderConfig({capability:'chat'})` instead of
  hardcoding `provider:'openrouter'`.
- `lib/translation-glossary.js`, `lib/office-translation.js` and
  `lib/pdf-inplace.js` are **not modified** — they already take an
  injected `translate`/`translator` callback and know nothing about which
  provider it calls. The masking guard runs completely unchanged
  regardless of provider, which is exactly the property that ruled out
  the dedicated MT feature in the first place.
- `lib/vexa-bridge.js`'s `runTranslationDelta()` (live in-meeting
  translation) is **explicitly out of scope** for this change — it shares
  a file and a hot poll loop with the Live-Meeting-STT work, and is
  migrated together with that change instead of being touched twice. When
  it does migrate, it will also route through `chat` (there is no
  dedicated capability left to route it to).
- EdenAI's native document-translation product (upload a Word/PDF, get a
  translated file back with layout preserved) is **not adopted**, for the
  same reason as the dedicated MT engine: the existing local extraction/
  reassembly pipeline preserves the glossary/translation-memory/quality-
  guard machinery and the GxP-relevant layout report that a native
  document-translation response has no equivalent for.
- **No EdenAI capability named `translation` exists.** `lib/edenai.js`'s
  `EDENAI_CAPABILITIES`/`EDENAI_CAPABILITY_MODEL_SHAPE`/
  `EDENAI_HARDCODED_MODEL` have five entries (chat, ocr, transcription,
  liveTranscription, tts), not six — mirroring exactly how `grammar` was
  removed in `hardcode-edenai-models` in favor of routing through `chat`.
  The EdenAI settings panel therefore shows no separate "Übersetzung"
  card; translation becomes usable the moment a workspace activates
  `chat`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `edenai-provider`: `chat`'s existing "Hardcoded Per-Capability Model"
  requirement (from `hardcode-edenai-models`) now explicitly also covers
  translation-shaped operations; no new adapter requirement is added.
- `openrouter-provider`: "Single Application-Facing AI Provider" is
  reworded to an evergreen form, since this is the first capability that
  can route away from OpenRouter for a migrated workspace.

## Impact

- Changed: `pages/api/translate.js`, `pages/api/translate/file.js`
- Changed: `lib/edenai-service.js` (new exports), `lib/edenai-pricing.js`
  (translation-shaped operations moved under `chat`)
- Unchanged: `lib/translation-glossary.js`, `lib/office-translation.js`,
  `lib/pdf-inplace.js`, translation-memory functions
- Deferred to `migrate-live-meeting-stt-to-edenai`: `lib/vexa-bridge.js`
