# Status: Layout-Preserving PDF Translation

Last updated: 2026-07-17

## Current State

- **Implemented (phase 1) — digital PDFs translated in place; scans keep
  the OCR fallback.** Approved by product owner (2026-07-16).
- Depends on `upstream-translation-glossary` (the in-place path reuses the
  same glossary/TM machinery as the office flow, from day one).

## What shipped

- `lib/pdf-inplace.js`:
  - `detectTextLayer` — samples up to 3 pages via pdfjs `getTextContent`;
    digital when sampled pages average ≥ 40 non-whitespace chars
    (`MIN_CHARS_PER_TEXT_PAGE`). pdfjs runs on the Legacy Node build with
    no worker.
  - `extractRuns` — positioned runs per page (str, x/y, width, fontSize,
    fontName/fontFamily, glyph-box top/bottom) in PDF bottom-left space,
    which pdf-lib draws in directly (no Y-flip).
  - `segmentRuns` — gutter-based column detection first (so aligned
    two-column rows never merge), then y-clustered lines and paragraph
    grouping; preserves the run→segment map and reading order.
  - `rewritePdf` — white-out original run boxes + redraw the translation;
    returns the layout report `{pages, segments, translated, overflows,
    fontFallbacks, nonEncodable, mode}`.
  - `isWinAnsiEncodable` / `findNonEncodableTranslations` — the encodability
    gate the integration uses to reroute non-latin targets.
- `pages/api/translate/file.js` — PDF path detects the text layer and
  routes digital + latin-target PDFs through the in-place pipeline (budget
  gate + usage logging + history/audit parity with the office path); scans,
  non-latin targets, non-encodable results, and any in-place failure fall
  through to the unchanged OCR path, flagged `approximated`.
- Tests: `tests/pdf-inplace-segmentation.test.mjs`,
  `tests/pdf-inplace-rewrite.test.mjs` (fixtures built with pdf-lib).
- Docs: `docs/ai-integration.md` (digital-vs-scan + layout report),
  CHANGELOG `[Unreleased] › Added`.

## Phase-1 decisions

- **Font strategy:** replacement text is rendered with pdf-lib StandardFonts
  (Helvetica / Helvetica-Bold; Times family when the original font looks
  serif; Courier for monospace). WinAnsi encoding covers Latin-1 incl.
  ä/ö/ü/ß/€ — sufficient for the phase-1 latin-script scope.
- **Non-encodable target text is never `?`-stripped:** it is detected up
  front (coarse language gate) and as a post-translation safety net, and
  the file is routed to the OCR fallback with a clear reason in the report.
- **Overflow (binding):** width-scale via font-size step-down bounded at
  −20 %; then wrap within the paragraph bbox for multi-line paragraphs;
  never truncate — residual overflow is counted.
- **White-out + redraw:** the original text objects remain in the stream
  under the white rectangles (documented confidentiality trade-off);
  stripping them is phase 2.
- **Columns:** clean single- and two-column layouts are handled; unreliable
  splits (lines straddling the gutter, one side nearly empty) collapse to
  single-column ordering — a wrong reading order is worse than an honest
  single-column pass.

## Open points

- Manual verification matrix (tasks.md §4) needs a live env with real PDFs.
- CJK / RTL / cyrillic / greek targets gated behind the encodability check
  (route to OCR); Unicode font embedding is phase 2.
- Original-text stripping under the white-out is phase 2.
- Surface the layout report in the translate UI (headers/audit exist).
- Mirror this spec into romaco-scriptor after stabilization.
