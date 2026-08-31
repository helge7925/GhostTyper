# Third-Party PDF Fonts

The in-place PDF translation path uses deterministic application dependencies;
it does not discover or load host fonts.

| Asset | Package | Version | License | Use |
| --- | --- | --- | --- | --- |
| Noto Sans | `@fontsource/noto-sans` | 5.3.0 | SIL Open Font License 1.1 | German and English regular/bold/italic/bold-italic |
| Noto Sans Arabic | `@fontsource/noto-sans-arabic` | 5.3.0 | SIL Open Font License 1.1 | Arabic glyph chunks |
| Noto Sans SC | `@fontsource/noto-sans-sc` | 5.3.0 | SIL Open Font License 1.1 | Simplified Chinese glyph chunks |
| Noto Sans TC | `@fontsource/noto-sans-tc` | 5.3.0 | SIL Open Font License 1.1 | Traditional Chinese glyph chunks |

The complete license text is supplied as `LICENSE` in each locked package. The
Docker build copies those notices to `/app/pdf-fonts/<family>/LICENSE` beside
the runtime font files. Fontsource packages retain the upstream Google Noto
attribution and OFL metadata.

Font selection is based on actual per-character glyph coverage. German and
English preserve regular, bold, italic and bold-italic intent through Noto Sans;
Arabic and Simplified/Traditional Chinese use matching Noto Sans Arabic/SC/TC
regular chunks.
`@pdf-lib/fontkit` embeds only selected assets, enables subsetting, and caches
each embedded asset once per document. The same embedded font is used for width
measurement, wrapping, overflow checks and drawing. Missing glyphs produce
`PDF_FONT_COVERAGE` and fail closed before an in-place file is returned.

`@pdf-lib/fontkit` and `pdf-lib` are MIT-licensed. The source-text redaction
engine in `lib/pdf-redaction-engine.js` uses only `pdf-lib`; no MuPDF,
PyMuPDF, AGPL component, or system-font dependency is included.

## Content-stream redaction guarantee

For a successful in-place result, `pdf-lib-content-stream-v1` removes supported
PDF text-show operations (`Tj`, `TJ`, `'`, `"`) and their operands from every
translated page content stream and every Form XObject. It does not paint white
cover rectangles. Supported image and non-text vector operations remain in the
stream; links overlapping translated regions are removed to avoid stale source
targets. Saving creates replacement compressed streams with object streams
disabled.

The intermediate redacted PDF is independently extracted and must contain no
text runs on translated pages. The final PDF is extracted again; every target
segment must be present and every non-identical source segment of at least four
characters must be absent. Only after both checks does the layout report set
`sourceTextVerification.verified` to `true`.

This is a deliberately narrow, fail-closed guarantee, not a claim of universal
PDF sanitization. The in-place path rejects inline-image grammar, active text
clipping, direct content streams, malformed text/content objects, streams that
cannot be decoded, unsupported stream object types, insufficient mapping from
extracted segments to text operators, missing glyphs, and any failed residual
or target extraction check. Such input routes to the visibly labeled
approximated-layout fallback (or a typed error); a white-out-only result is
never returned. Broader arbitrary-PDF vector redaction would require a separately
approved commercial engine.

The locked package versions and notices are present in source, but external
organizational font/license approval and legal acceptance of this redaction
boundary remain release gates until recorded by the responsible reviewers.
