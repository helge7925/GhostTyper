# Change: Layout-Preserving PDF Translation (DeepL-style)

## Why

Today's PDF translation is lossy: OCR → Markdown → HTML → a freshly
rendered PDF. Fonts, columns, tables, images and pagination are gone.
DeepL sets the quality bar by replacing text inside the original layout.
Decision 2026-07-16: build layout-preserving translation for digital
PDFs; keep the OCR path only as a fallback for scans.

## Decisions Captured

- Digital PDFs (embedded text layer) SHALL be translated in place:
  extract positioned text runs, translate segment-wise, write translated
  runs back at the original positions in the original PDF.
- Scanned PDFs (no text layer) SHALL fall back to the existing
  OCR → re-render path, clearly labeled as "layout approximated".
- Glossary/TM SHALL apply to both paths (depends on
  `upstream-translation-glossary`).
- Overflow strategy: auto font-size step-down (bounded, e.g. max −20%)
  then character-level condensed spacing; never silently truncate.
- Non-latin target scripts fall back to an embedded Unicode font when the
  original font lacks glyphs.
- A per-file layout report (segments translated, overflows, font
  substitutions) SHALL be returned in the response headers/UI, mirroring
  the existing `X-GhostTyper-Layout-Warnings` pattern.

## Technical Sketch (details in design.md)

1. Parse with `pdfjs-dist` (positions, styles) — server-side.
2. Group text items into logical segments (line/paragraph heuristics —
   reuse `splitMarkdownIntoSegments` sizing limits for API batching).
3. Translate via existing `translateTextSegments` (strict JSON array,
   glossary block).
4. Rewrite via `pdf-lib`: cover original runs, draw translated runs with
   matched font metrics; embed fallback font (e.g. Noto Sans) on demand.

## Impact

- New dependencies: `pdfjs-dist`, `pdf-lib`, one embeddable Unicode font.
- Chromium renderer stays (scan fallback + existing exports).
- Ported to romaco-scriptor after stabilization (mirror spec there).
