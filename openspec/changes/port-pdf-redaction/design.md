# Design: Port PDF Redaction Engine And Font Handling

## Source

Downstream `romaco-scriptor`:

- `lib/pdf-redaction-engine.js` (~560 LOC)
- `lib/pdf-fonts.js` (~218 LOC)

Neither has customer-specific references. Upstream already has
`pdf-export.js`, `pdf-inplace.js`, `pdf-print-style.js` and
`pdf-render-limiter.js`, so this slots into an existing PDF stack.

## Redaction Approach

The engine removes content rather than overlaying it. The distinction
matters: drawing a filled rectangle over text leaves the text in the
content stream, where any extractor recovers it. The ported engine
operates on the content stream so redacted runs are gone from the file.

Verification is therefore not visual — the test asserts that extracting
text from the output does not contain the redacted string.

## Font Handling

`pdf-fonts.js` resolves and embeds a font covering the script present in
the content. Without it, generated PDFs fall back to a base font whose
glyph coverage is Latin-only, producing tofu for CJK/Arabic/Cyrillic —
which the product otherwise supports end to end in transcription and
translation.

Wire this into the existing export path rather than creating a parallel
one, and keep Latin-only output byte-comparable where practical so
existing behaviour does not regress.

## Interaction With `pdf-render-limiter`

Redaction runs on documents that already pass the existing render limits;
do not bypass the limiter. A document too large to render is also too
large to redact.

## Files Changed

- `lib/pdf-redaction-engine.js`, `lib/pdf-fonts.js` (new, ported)
- the existing PDF export path (font wiring)
- document/transcription PDF export UI surface
- `messages/de.json`, `messages/en.json`
- `tests/pdf-redaction.test.mjs` (new)

## Risks

- The correctness bar is "not extractable", not "not visible" — a test
  that only checks rendering would pass a broken implementation.
- Embedded fonts increase output size; check the render limiter's bounds
  still hold.
