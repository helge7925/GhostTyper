# Status: Migrate OCR Extraction To EdenAI

Last updated: 2026-08-30

## Current State

- **Implemented**, two manual-verification tasks (5.1/5.2) remaining —
  the pricing runbook step (3.1) that used to be the other open item is
  now closed, see below. Fourth capability decided under the
  `hardcode-edenai-models` architecture.

## Pricing seeded automatically (2026-08-31)

Task 3.1's admin-runbook price row now ships as code instead:
`lib/pricing-seed.js`'s `INITIAL_PROVIDER_PRICES` seeds the `(edenai,
mistral/mistral-small-latest, ocr)` row automatically on every
`initDatabase()` call — no admin action needed. This rate is *derived*,
not quoted (EdenAI's catalogue has no flat per-image price for this
model — vision input is tokenized at the same rate as text), from one
real observed OCR call's actual token usage, rounded up for headroom.
See `migrate-live-meeting-stt-to-edenai/status.md` for the full
cross-cutting writeup of the seeding mechanism.

## Design correction: no dedicated document-parsing feature exists (2026-08-30)

This change originally planned around an assumed EdenAI "Custom Document
Parsing / Table Extraction" primitive, purpose-built for table-heavy
scans. Checking EdenAI's real, documented `ocr` category found only four
subfeatures: `ocr` (flat text, no structure), `identity_parser`,
`financial_parser`, `resume_parser` (all fixed-schema). No document-
parsing feature was ever real — the proposal's premise didn't hold.

Live-tested the flat `ocr/ocr` feature (google/amazon/microsoft) against
a synthetic table document: all three returned unstructured text with
table rows/columns disconnected from each other (Google even moved a
column header to the very end of the output) — the same class of defect
that ruled out a dedicated translation adapter in
`migrate-translation-to-edenai`. `ocr/ocr/mistral` (EdenAI's OCR endpoint
using Mistral's own OCR engine) was excellent on the same image — correct
markdown, correct table — but rejects PDF outright
(`provider_status_code: 400`, "Supported mimetypes are image/*").

OCR routes through `chat` instead — `mistral/mistral-small-latest`
(already hardcoded) is vision-capable and, on the same test image via
`/chat/completions` with `performOCR`'s existing extraction prompt,
matched `ocr/ocr/mistral`'s quality exactly. This mirrors
`migrate-translation-to-edenai`'s finding precisely: a general
instruction-following chat model beats a schema-flat dedicated feature
whenever the task needs structure a fixed schema can't express.

## Design correction: PDF needed a real architecture decision, not a default (2026-08-30)

Unlike translation, this gap couldn't be closed by routing through chat
alone: EdenAI's chat/completions has no working PDF content-block support
against Mistral (two different payload shapes both rejected — see
design.md for the exact errors), and `ocr/ocr/mistral` is image-only.
Since PDF is a primary OCR input for this app (scans/invoices), this was
put to the user directly as a real trade-off, not decided unilaterally:
rasterize PDFs to images and reuse the proven vision path (new Docker
dependency, real implementation, full quality) vs. leaving PDFs on
OpenRouter (no new dependency, capability split by mimetype) vs. a flat-
text fallback for PDFs only (full migration, real quality loss). The user
chose rasterization — poppler (`pdfinfo`/`pdftoppm`), already alongside
ffmpeg/chromium in the Docker image's dependency pattern.

## Implementation (2026-08-30)

- New `lib/pdf-rasterize.js`: `rasterizePdfToImages(pdfPath)` — poppler-
  based, one PNG buffer per page, capped at `MAX_OCR_PDF_PAGES` (default
  20, throws `PDF_TOO_MANY_PAGES` before rendering anything if exceeded),
  configurable DPI (`OCR_RASTERIZE_DPI`, default 150), always cleans up
  its temp directory in a `finally`.
- `lib/edenai-service.js`: new `performOcrEdenAi` — images go through as
  a single `image_url` block; PDFs rasterize first and go through as
  multiple `image_url` blocks in one chat message (one call per document,
  not per page — keeps the same one-call/one-usage-record contract
  `performOCR` already has), with a prompt variant instructing the model
  to treat multiple images as consecutive pages of one document.
- `Dockerfile`: `poppler-utils` added alongside ffmpeg/chromium;
  `docs/docker-setup.md` updated.
- `lib/edenai.js`: no `ocr` entry in `EDENAI_CAPABILITIES`/
  `EDENAI_CAPABILITY_MODEL_SHAPE`/`EDENAI_HARDCODED_MODEL` — OCR has no
  capability of its own, mirroring `translation`'s fate in the prior
  change.
- `lib/edenai-pricing.js`: `ocr` operation moved into
  `EDENAI_OPERATIONS.chat` (now 8 operations).
- `pages/api/ocr.js`: extraction block resolves
  `resolveActiveProviderConfig({capability:'chat'})`; the model-resolution
  gate now branches (EdenAI: `activeOcr.model`; OpenRouter: unchanged
  `resolveConfiguredModel(openrouter, 'ocr', ...)`, since OpenRouter still
  has its own independently-configurable OCR model slot, untouched by
  this change). Analysis block confirmed untouched, still hardcoded to
  OpenRouter — same standing exception as
  `migrate-batch-transcription-to-edenai`. Added a `PDF_TOO_MANY_PAGES`
  → `400` error branch. Audit metadata gained `ocrProvider`.
- `pages/api/translate/file.js`: scanned-PDF OCR-fallback block gets the
  same treatment, reusing the file's existing `capability:'chat'`
  resolution (already resolved once for translation — both features
  share EdenAI's one hardcoded model, so resolving twice would be
  redundant). Renamed the fallback's error code from `NO_OPENROUTER_OCR`
  to the now-accurate `NO_OCR_PROVIDER` (and its one reference); added
  `PDF_TOO_MANY_PAGES` to the caught-error list; fixed a now-stale
  `ocrProvider: 'openrouter'` audit-metadata literal to the real
  `active.provider`.
- `components/settings/EdenAiIntegrationPanel.js`: `chat`'s label
  extended to mention OCR; the `ocr` label entry removed (the panel is
  capability-array-driven, so its card disappears automatically).
  `pages/api/organizations/integrations/edenai/activate.js`'s comment
  updated to stop describing `ocr`/`translation` as capabilities with
  "no confirmed input shape yet" — neither is a capability at all now.
- Tests: new `tests/pdf-rasterize.test.mjs` (3 tests, real rasterization
  via a `pdf-lib`-generated PDF) and `tests/edenai-ocr.test.mjs` (6
  tests, mocked fetch + real rasterization for the PDF cases). Both
  PDF-dependent test files skip gracefully (not fail) if `pdfinfo` isn't
  present in the environment running `npm test`, mirroring
  `estimateAudioDurationSeconds`'s existing soft-fallback treatment of a
  missing ffprobe. `tests/edenai.test.mjs`/`tests/edenai-pricing.test.mjs`/
  `tests/edenai-pricing-gate.test.mjs`/`tests/ai-provider-router.test.mjs`
  updated for the four-capability list and the pricing-operation move.
  `npm test` → 458 tests / 446 pass / 12 skipped / 0 failed (up from
  450/438/12/0). Lint clean.
- Verification: live-called the actual shipped `performOcrEdenAi` (not a
  reimplementation) against production EdenAI with a real 2-page
  synthetic invoice PDF (heading, address, a line-items table, a totals
  section split across the page boundary) and a real PNG — both correct,
  the PDF's two pages merged into one coherent Markdown document with no
  page-break artifacts, correct German decimal-comma formatting. Key
  deleted from scratchpad after each of the three uses this round
  (initial OCR-vs-chat comparison, PDF-content-block investigation, final
  shipped-code smoke test), no leak (repo-wide grep clean each time).
- `openspec validate migrate-ocr-extraction-to-edenai --strict` passes.

## Outstanding

- Tasks 5.1/5.2: full DB + `next dev` + browser manual verification
  (activate `chat`, upload a table-heavy scan through the real UI,
  confirm the analysis pipeline and the scanned-PDF translation flow) —
  not yet run, same open-item pattern as the two prior EdenAI migrations.
- The very-long-PDF context-limit risk (design.md) is flagged, not
  measured — the 20-page cap is a reasonable default, not a verified
  safe limit for `mistral-small-latest`'s actual context window when
  every page is a full-resolution embedded image.
- poppler-utils is a new Docker image dependency — requires a rebuild
  before this ships to any environment that pulls a cached image.
