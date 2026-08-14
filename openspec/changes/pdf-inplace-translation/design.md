# Design: Layout-Preserving PDF Translation

## Pipeline

```
upload.pdf
  └─ detect text layer (pdfjs getTextContent on sample pages)
      ├─ digital → IN-PLACE PATH
      │    1. extract runs {str, transform, fontName, fontSize, width}
      │    2. segment: merge runs into lines (y-cluster), lines into
      │       paragraphs (x-overlap + leading); keep run→segment map
      │    3. batch-translate segments (translateTextSegments, glossary
      │       block, TM lookup first — batched)
      │    4. rewrite (pdf-lib):
      │       - white-out original run bboxes (fill rect, bg-sampled)
      │       - draw translated text per segment box: original font if
      │         embeddable+has glyphs, else fallback font
      │       - fit: width-scale ≥0.8 → font-step-down ≥80% → wrap within
      │         segment bbox if multi-line paragraph
      │    5. stats: {segments, tmHits, overflows, fontFallbacks}
      └─ scan → FALLBACK PATH (existing OCR → MD → HTML → PDF),
         response flagged `layoutMode: "approximated"`
```

## Key decisions & risks

- **White-out vs. content-stream editing**: overlay (white-out + redraw)
  is chosen over true content-stream token editing — far simpler, robust
  across producers; cost: original text remains in the file underneath.
  Mitigation for confidentiality: optionally strip original text objects
  of replaced runs in a post-pass (phase 2).
- **RTL / CJK**: phase 1 targets latin/cyrillic/greek targets; CJK/RTL
  gated behind a capability check with clear UI messaging.
- **Tables/forms**: text inside AcroForm fields is out of scope phase 1
  (fields are preserved untouched, reported in stats).
- **Cost control**: same budget gate as office path
  (`assertBudgetWithinLimits` with `estimateTextTransformCost` on the
  extracted text) before any provider call.
- **Determinism for GxP (Romaco port)**: layout report is persisted with
  the history row so an auditor can see what was altered.

## Testing

- Golden-file tests: small fixture PDFs (single column, two column,
  table, mixed fonts) → assert extracted segment count, no overflow
  regressions, output opens and contains translated strings (pdfjs
  re-extract).
- Property test: translate de→de (identity-ish) keeps segment count.
