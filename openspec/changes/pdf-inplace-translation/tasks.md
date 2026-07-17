# Tasks: Layout-Preserving PDF Translation

## 1. Foundations
- [x] Add `pdfjs-dist` + `pdf-lib`; license check. (No embeddable Unicode
      font added — phase 1 renders with pdf-lib StandardFonts / WinAnsi;
      full font matching + Unicode embedding is phase 2.)
- [x] `lib/pdf-inplace.js`: text-layer detection + run extraction.
- [x] Segmenter (runs → lines → paragraphs) with unit tests on fixtures.

## 2. Translate & rewrite
- [x] Batched TM lookup + glossary block (reuses `translateSegmentsWithGlossary`
      / `translateSegmentsWithGlossaryGuard` — same path as the office flow).
- [x] pdf-lib rewrite pass (white-out, redraw, fit strategy). Font
      *fallback* uses StandardFonts by serif/mono/sans classification;
      Unicode font embedding deferred to phase 2.
- [x] Layout report (stats) + response headers (`X-GhostTyper-Layout`,
      `X-GhostTyper-PDF-Layout-Mode`). UI display of the report is a
      follow-up (headers are emitted and audited today).

## 3. Integration
- [x] `pages/api/translate/file.js`: route digital PDFs to in-place
      path; scans keep OCR fallback (flagged `approximated`).
- [x] Budget gate + usage logging parity with office path.
- [x] History row + audit metadata store the layout report / mode.

## 4. Verification
- [x] Golden-file tests green (segmentation + rewrite round-trip,
      overflow counting, non-encodable safety net). Fixtures are built
      programmatically with pdf-lib — no binaries in the repo.
- [ ] Manual matrix (needs a live env + real PDFs): 1-col report,
      2-col datasheet, table-heavy manual, scanned PDF (fallback),
      long→short (de→en) and short→long (en→de).
- [x] Docs + CHANGELOG.
- [ ] Mirror spec in romaco-scriptor (after stabilization).

## Open points / phase-2
- Strip original text objects under the white-out (confidentiality).
- Embed a Unicode fallback font → CJK/RTL/cyrillic/greek targets
  (today routed to the OCR fallback).
- True font matching/embedding instead of StandardFont substitution.
- AcroForm field text (preserved untouched today).
- Non-encodable target currently reroutes to OCR *after* translating the
  segments (double cost in that rare case); a pre-translation script
  check could avoid it.
- Surface the layout report in the translate UI (headers exist).
