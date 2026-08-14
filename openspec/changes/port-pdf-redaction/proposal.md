# Change: Port PDF Redaction Engine And Font Handling From Downstream

## Why

GhostTyper renders and translates PDFs in place (`lib/pdf-inplace.js`,
`lib/pdf-export.js`), but it cannot remove content from one. Anyone who
needs to share a transcript or document with names, addresses or
commercial terms removed has to leave the product to do it — and PDF
redaction done by drawing black boxes leaves the text underneath intact,
which is exactly the mistake users make on their own.

Separately, PDF output currently has no explicit font handling. As soon as
non-Latin script (CJK, Arabic, Cyrillic) reaches a generated PDF, glyphs
fall back to tofu boxes.

Downstream `romaco-scriptor` has both: `lib/pdf-redaction-engine.js` (~560
LOC) and `lib/pdf-fonts.js` (~218 LOC), neither with customer-specific
references.

## Decisions Captured

- Redaction SHALL remove the underlying content, not merely cover it.
- Redacted output SHALL not retain the removed text in any extractable
  layer.
- PDF generation SHALL embed fonts covering the scripts the product
  already supports for transcription and translation.

## What Changes

- Port `lib/pdf-redaction-engine.js` and `lib/pdf-fonts.js`.
- Wire font handling into the existing PDF export path.
- Expose redaction on the document/transcription PDF export surface.
- Add de/en i18n strings.

## Out Of Scope

- Automatic PII detection — this change provides the redaction mechanism,
  not a classifier that decides what to redact.
- OCR-ing scanned PDFs to make image-only content redactable.
- Redaction of non-PDF formats.

## Success Criteria

- Redacted regions contain no extractable text in the output file.
- Text extraction on a redacted PDF does not reveal removed content.
- Generated PDFs render non-Latin script correctly instead of tofu boxes.
- Existing PDF export and in-place translation behaviour is unchanged.
