# Design: Migrate OCR Extraction To EdenAI

## The Split

`pages/api/ocr.js` already runs two independent `executeReservedSpend`
blocks: `operation:'ocr'` (raw extraction, calls `performOCR`) and
`operation:'analysis'` (structuring, calls `analyzeTranscription`). This
change migrates only the first — the analysis block keeps its own
hardcoded `resolveOpenRouterConfig` call, completely untouched, per the
master plan's standing exception list (same boundary already applied to
`transcription-worker.js`'s analysis block in
`migrate-batch-transcription-to-edenai`; see that change's design.md for
the full "Design correction" reasoning, which applies identically here).
During the transition, a single OCR-with-analysis request can call
EdenAI for extraction and OpenRouter for structuring **in the same HTTP
request** — intended, not a defect, the same "two providers, one job"
pattern the Batch-STT change introduced.

## Live Evidence: No Dedicated Document-Parsing Feature Exists (2026-08-30)

This change was originally scoped around an assumed EdenAI "Custom
Document Parsing / Table Extraction" primitive. Checking EdenAI's real,
documented feature list settled it: the `ocr` category has exactly four
subfeatures —

```json
"ocr": ["ocr", "identity_parser", "financial_parser", "resume_parser"]
```

`identity_parser`/`financial_parser`/`resume_parser` are fixed-schema
(ID documents, invoices/receipts, résumés) and don't fit this app's
arbitrary, user-defined `table_schema`. `ocr/ocr` is the only
general-purpose option — its own documented `output_schema` is
`{text, bounding_boxes}`, no structure/formatting guarantee at all.

### Round 1 — is the dedicated feature good enough anyway?

Live-tested `ocr/ocr` (google/amazon/microsoft — all EU) against a
locally-generated synthetic business document (heading, paragraph, a
3-row/3-column bordered table — never real user data; real `.m4a`/scan
files sitting in this app's own `uploads/` were not touched, same
practice as the transcription-model comparison). All three returned flat
text with the table fully collapsed:

| Provider | Result |
|---|---|
| google | Table values scrambled — the "Status" column header moved to the *end* of the output, disconnected from its column |
| amazon | Reading order closer to correct, but still one undifferentiated block — no way to programmatically recover which value belongs to which row/column |
| microsoft | Same flat-text problem, plus a character-recognition error ("Betrag (EUR)" → "Betrag (EI-JR)") |

Also tested `ocr/ocr/mistral` specifically (EdenAI's own OCR endpoint,
Mistral's OCR engine as the backend) on the same image: markdown output,
headings preserved, and a correctly-structured pipe-delimited table —
genuinely excellent. But it rejects PDF outright:
`"Provider mistral doesn't support file type: application/pdf for this
feature. Supported mimetypes are image/*"` (confirmed live,
`provider_status_code: 400`) — a hard blocker, since PDF is one of five
accepted OCR input types in this app and, in practice, the more common
one for scans/invoices, not an edge case.

### Round 2 — does `chat`/mistral-small-latest do any better?

EdenAI's live model catalogue confirms `mistral/mistral-small-latest`
(already hardcoded for `chat`) has `input_modalities: ["text","image"]`
— it's vision-capable. Sent the same synthetic test image through
`/chat/completions` with the exact extraction prompt `performOCR`
already uses ("Extract every visible word... preserve headings,
paragraphs, lists and tables... faithful Markdown"):

```markdown
# Quartalsbericht Q3 2026

Sehr geehrte Damen und Herren, ...

## Kostenaufstellung

| Kategorie | Betrag (EUR) | Status |
|-----------|--------------|--------|
| Server-Infrastruktur | 12.500 | Bezahlt |
| Marketing | 7.200 | Offen |
| Reisekosten | 3.150 | Bezahlt |
...
```

Flawless — headings, table structure, and cell values all correct,
matching `ocr/ocr/mistral`'s quality on the same image. This settles the
image case in `chat`'s favor for the same reason `translation` and
`spelling_grammar` did: a general instruction-following chat model beats
a schema-flat dedicated feature whenever the *task* needs structure
preservation the dedicated feature's schema can't express.

### Round 3 — PDF is the real gap

`chat`/mistral-small-latest doesn't solve PDF on its own. Two attempts,
both rejected by Mistral's underlying API (reached through EdenAI):

1. OpenRouter's own `{type:'file', file:{filename, file_data}}` content
   block shape — EdenAI's schema accepts it (it's a documented content
   type), but Mistral's endpoint returned `"MistralException - Input
   should be a valid string"`, meaning Mistral's real API doesn't accept
   an array-of-content-blocks message when a `file` block is present the
   way OpenRouter's gateway does (OpenRouter does its own file-parsing
   preprocessing before ever calling Mistral; EdenAI's pass-through does
   not).
2. Retried with `file: {file_id: '<edenai-upload-id>'}` instead of
   inline `file_data` — EdenAI resolves the file_id back to the exact
   same inline base64 payload before forwarding, so the identical error
   came back. Confirms this isn't a request-shape mistake on this app's
   side; it's a genuine gap in what EdenAI's chat pass-through supports
   for Mistral specifically.

So neither of the two "route through chat" candidates (dedicated OCR
endpoint, direct PDF-in-chat) reaches PDFs. This was put to the user
directly — a real architecture fork, not a model-quality judgment call —
with three options: rasterize PDFs to images and reuse the proven
image-vision path (new system dependency, real implementation, full
quality); leave PDF OCR on OpenRouter and only migrate images (no new
dependency, but the `ocr` "capability" ends up split by mimetype); or
accept `ocr/ocr/amazon`'s flat-text quality for PDFs specifically (full
migration, but a real regression for anything table-shaped). The user
chose rasterization.

## `performOcrEdenAi` / `lib/pdf-rasterize.js`

For an image mimetype, sends one `image_url` content block directly — no
extra step needed, `mistral-small-latest` handles it natively.

For `application/pdf`, `lib/pdf-rasterize.js`'s `rasterizePdfToImages()`
shells out to poppler's `pdfinfo` (page count, enforced against
`MAX_OCR_PDF_PAGES`, default 20 — throws `PDF_TOO_MANY_PAGES` *before*
rendering anything for an oversized document) then `pdftoppm -png -r
150` (rasterize, default 150 DPI) into a temp directory, returning one
PNG buffer per page in order, always cleaned up in a `finally`. All
pages are sent as consecutive `image_url` blocks in **one** chat message
— not one call per page — with a prompt instructing the model to treat
them as consecutive pages of a single document and produce one
continuous Markdown output, no page-break markers or repeated headers.
Verified live end-to-end on a real 2-page synthetic invoice (heading,
address block, a line-items table, then a totals section split across
the page boundary): both pages correctly extracted and merged into one
coherent document, correct table, correct German decimal-comma
formatting ("313,50 EUR"), no artifacts at the page seam.

One call per document (not per page) keeps this consistent with
`performOCR`'s existing one-call, one-usage-record contract — no new
per-page budget-reservation logic needed, `pages/api/ocr.js`'s existing
single `executeReservedSpend` block for `operation:'ocr'` is unchanged.
The trade-off: a very long document could in principle approach model
context limits before hitting the 20-page cap; not measured, flagged as
an open risk below rather than assumed fine.

poppler-utils (`pdfinfo`/`pdftoppm`) is added to the Docker image
alongside the already-present ffmpeg/chromium (`docs/docker-setup.md`
updated to match). Tests that need real rasterization
(`tests/pdf-rasterize.test.mjs`, part of `tests/edenai-ocr.test.mjs`)
check for `pdfinfo` at startup and skip (not fail) if it's genuinely
unavailable in whatever environment runs `npm test` — mirroring how
`estimateAudioDurationSeconds` (`lib/ai-service.js`) treats a missing
ffprobe as a soft-fallback condition, not a hard requirement.

## Second Call Site

`pages/api/translate/file.js`'s scanned-PDF OCR-fallback block (OCR →
Markdown → chunked translation → re-rendered PDF) gets the same
treatment — but since that file already resolves `capability:'chat'`
once for its own translation step (see `migrate-translation-to-edenai`),
the OCR step reuses that same resolution rather than calling
`resolveActiveProviderConfig` a second time. On OpenRouter, OCR keeps its
own independently-configurable model slot (`resolveConfiguredModel(...,
'ocr', ...)`, unrelated to this migration and unchanged); on EdenAI it
shares the one hardcoded `chat` model with translation, since there's
nothing else for it to route through.

## Risks / Trade-offs

- **Very long PDFs**: the 20-page cap is a reasonable-sounding default,
  not a measured limit — a document near that cap could still approach
  `mistral-small-latest`'s context window once every page is a
  base64-encoded image in the same message. Not measured here; a real
  risk to watch, not a verified non-issue.
- **poppler as a new Docker dependency**: a real, if small, infrastructure
  change (one more `apk add` package) requiring an image rebuild before
  this ships to production — flagged explicitly since it wasn't asked
  for on its own, only as a consequence of the PDF gap found above.
- **`estimateOcrPages()`'s pre-call budget estimate** (`pages/api/ocr.js`,
  regex-counts PDF page objects) is used for the reservation regardless
  of provider — its cap (10,000 pages) is far looser than
  `MAX_OCR_PDF_PAGES` (20), so a large PDF still gets a budget hold
  placed before `performOcrEdenAi` rejects it with `PDF_TOO_MANY_PAGES`.
  The reservation is released the same way any other work-function error
  releases it (existing `executeReservedSpend` behavior, unmodified) —
  not a budget leak, but worth naming since it's a slightly wasted
  round-trip specific to the EdenAI path.
