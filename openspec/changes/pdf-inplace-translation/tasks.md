# Tasks: Layout-Preserving PDF Translation

## 1. Foundations
- [ ] Add `pdfjs-dist` + `pdf-lib` + fallback font; license check.
- [ ] `lib/pdf-inplace.js`: text-layer detection + run extraction.
- [ ] Segmenter (runs → lines → paragraphs) with unit tests on fixtures.

## 2. Translate & rewrite
- [ ] Batched TM lookup + glossary block (from
      `upstream-translation-glossary`).
- [ ] pdf-lib rewrite pass (white-out, redraw, fit strategy, fallback
      font embedding).
- [ ] Layout report (stats) + response headers + UI display.

## 3. Integration
- [ ] `pages/api/translate/file.js`: route digital PDFs to in-place
      path; scans keep OCR fallback (flagged).
- [ ] Budget gate + usage logging parity with office path.
- [ ] History row stores layout report.

## 4. Verification
- [ ] Golden-file tests green; manual matrix: 1-col report, 2-col
      datasheet, table-heavy manual, scanned PDF (fallback), long → short
      language pair (de→en) and short → long (en→de).
- [ ] Docs + CHANGELOG; then open mirror spec in romaco-scriptor.
