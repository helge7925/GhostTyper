# Change: Migrate OCR Extraction To EdenAI

## Why

`performOCR` extracts document text via a vision-capable chat model and,
for PDFs, OpenRouter's `mistral-ocr` file-parser plugin.

This proposal originally assumed EdenAI exposes a "Custom Document
Parsing and Table Extraction" primitive purpose-built for table/form-heavy
scans. Live testing against EdenAI's real, documented feature set
(2026-08-30) found no such feature exists: EdenAI's `ocr` category has
exactly four subfeatures — `ocr` (flat text + bounding boxes, no
structure), `identity_parser`, `financial_parser`, `resume_parser` (all
fixed-schema, none fitting this app's arbitrary `table_schema` system).
Live comparison confirmed the flat `ocr/ocr` feature (tested against
google/amazon/microsoft) returns unstructured text with table rows and
columns disconnected from each other — the same class of defect that
ruled out a dedicated translation adapter in `migrate-translation-to-edenai`.

Instead, OCR routes through the `chat` capability, exactly like
`translation` and `spelling_grammar` before it: `mistral/mistral-small-
latest` (already hardcoded for `chat`) turns out to be vision-capable,
and given the same extraction prompt `performOCR` already uses, produces
markdown output — headings, paragraphs, correctly-structured tables —
matching (in live testing, indistinguishable from) EdenAI's own dedicated
`ocr/ocr/mistral` engine, which is the same Mistral OCR product
OpenRouter's `mistral-ocr` plugin already uses today.

One real gap remained: EdenAI's chat/completions has no working PDF
content-block support (confirmed live — both a `file_data` payload and a
`file_id` reference are rejected by Mistral's own API), and EdenAI's
dedicated `ocr/ocr/mistral` engine explicitly rejects `application/pdf`,
image-only. Since PDF is a primary OCR input type for this app (scans,
invoices), not an edge case, this is a real architecture question, not a
detail — put to the user explicitly rather than silently degrading PDF
quality or silently adding a new system dependency. The user chose:
rasterize a PDF to one image per page (poppler, already alongside
ffmpeg/chromium in the Docker image) and send all pages through the
proven image-vision-chat path in one message.

## What Changes

- `lib/edenai-service.js` gains `performOcrEdenAi`, calling EdenAI's
  `chat/completions` with the hardcoded `chat` model instead of a
  dedicated OCR endpoint. For images, sends one `image_url` content
  block directly. For PDFs, rasterizes to one PNG per page first
  (`lib/pdf-rasterize.js`, new — poppler `pdfinfo`/`pdftoppm` via
  `child_process`) and sends all pages as consecutive `image_url` blocks
  in a single chat message, with a prompt instructing the model to treat
  them as one continuous document. Capped at `MAX_OCR_PDF_PAGES` (default
  20) — throws `PDF_TOO_MANY_PAGES` before rendering anything if
  exceeded. Return shape matches `performOCR` exactly:
  `{markdown, usage, model, providerRequestId}`.
- `Dockerfile` gains `poppler-utils` alongside the existing
  ffmpeg/chromium install.
- `pages/api/ocr.js`'s OCR-extraction `executeReservedSpend` block
  resolves its provider via
  `resolveActiveProviderConfig({capability:'chat'})` — there is no
  dedicated `ocr` capability to route through. Its separate analysis
  block (structuring the Markdown into the user's template) is **not**
  migrated by this change and keeps its own hardcoded
  `resolveOpenRouterConfig` call, per the master plan's standing
  exception list for chat/analysis call sites (same boundary already
  applied in `migrate-batch-transcription-to-edenai`).
- The same router swap applies to the scanned-PDF OCR-fallback path in
  `pages/api/translate/file.js`, which — since both OCR and translation
  in that file now resolve the same `chat` capability — reuses the
  file's existing translation-capability resolution rather than
  resolving it a second time.
- The OpenRouter-only `plugins:[{id:'file-parser', pdf:{engine:'mistral-
  ocr'}}]` contract has no EdenAI equivalent and is simply absent from
  `performOcrEdenAi` — the PDF-to-image rasterization step replaces it.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `edenai-provider`: `chat`'s existing "Hardcoded Per-Capability Model"
  requirement now explicitly also covers OCR extraction; no new adapter
  requirement is added, since there is no dedicated OCR capability.

## Impact

- Changed: `pages/api/ocr.js` (extraction block only), `pages/api/
  translate/file.js` (OCR-fallback block only)
- Changed: `lib/edenai-service.js` (new export), `lib/edenai-pricing.js`
  (`ocr` operation moved under `chat`), `Dockerfile` (new system
  dependency)
- New: `lib/pdf-rasterize.js`
- Unchanged: `resolveTemplate`, `normalizeAndValidateTableAnalysis`,
  `normalizeDataTableAnalysis`, and every other downstream consumer of
  OCR output
