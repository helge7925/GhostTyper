# Tasks: Migrate OCR Extraction To EdenAI

## 1. EdenAI OCR Adapter

- [x] 1.1 `lib/edenai-service.js`: `performOcrEdenAi(filePath, apiKey,
  mimeType, options)` — **changed from the original plan**: no dedicated
  EdenAI document-parsing feature exists (see design.md's live evidence);
  routes through the `chat` capability's hardcoded vision-capable model
  instead, returning `{markdown, usage, model, providerRequestId}`.
- [x] 1.2 **Changed from the original plan** — no table-output
  normalization step exists or is needed: the model produces Markdown
  tables directly (verified live against a real synthetic multi-cell
  table document — see design.md), the same way `performOCR`'s
  OpenRouter path already does. There is no separate structured-table
  response to normalize.
- [x] 1.3 EdenAI `OPERATIONS` map: `ocr` moved into `EDENAI_OPERATIONS.chat`
  (no standalone `ocr` capability to have its own operations list).
- [x] 1.4 New `lib/pdf-rasterize.js`: `rasterizePdfToImages(pdfPath)` —
  poppler-based (`pdfinfo` for page count/cap enforcement, `pdftoppm` for
  rendering), one PNG buffer per page. Needed because EdenAI's
  chat/completions has no working PDF content-block support (confirmed
  live, two different payload shapes both rejected by Mistral's API) and
  its dedicated `ocr/ocr/mistral` engine rejects PDF outright,
  image-only.
- [x] 1.5 `Dockerfile`: added `poppler-utils` alongside ffmpeg/chromium;
  `docs/docker-setup.md` updated to match.

## 2. Call Sites

- [x] 2.1 `pages/api/ocr.js`: extraction block resolves provider via
  `resolveActiveProviderConfig({capability:'chat'})` (no `ocr` capability
  to route through). Analysis block confirmed independent and left
  untouched, hardcoded to OpenRouter — same standing exception as
  `migrate-batch-transcription-to-edenai`'s analysis block.
- [x] 2.2 `pages/api/translate/file.js`'s scanned-PDF OCR-fallback block:
  same router swap, reusing the file's existing `capability:'chat'`
  resolution (already computed once for translation) rather than
  resolving it a second time.

## 3. Pricing

- [x] 3.1 **Changed from the original plan** — done via code, not an
  admin runbook step. The `(edenai, mistral/mistral-small-latest, ocr)`
  price row is now seeded automatically by `lib/pricing-seed.js`'s
  `INITIAL_PROVIDER_PRICES` on every `initDatabase()` call — no admin
  action needed. Unlike the token-based `chat` operations, this row's
  rate is *derived*, not quoted: EdenAI's model catalogue has no flat
  per-image price for `mistral/mistral-small-latest` (vision input is
  tokenized, billed at the same per-token rate as text), so the page
  rate is estimated from one real observed OCR call's actual token usage
  (prompt_tokens=2242, completion_tokens=117 for a synthetic one-page
  business document), rounded up for headroom against denser real
  documents — see `lib/pricing-seed.js`'s comment for the full
  derivation and `migrate-live-meeting-stt-to-edenai/status.md` for the
  cross-cutting writeup of the seeding mechanism itself.

## 4. Tests

- [x] 4.1 `tests/edenai-ocr.test.mjs`: 6 mocked-fetch contract tests for
  `performOcrEdenAi` — single image_url block for images, return-shape
  contract, `MODEL_UNAVAILABLE`, multi-page-PDF multi-image-block
  request shape (real rasterization via a `pdf-lib`-generated PDF, not
  mocked), single-page-PDF prompt variant, `PDF_TOO_MANY_PAGES`
  propagation. PDF-dependent tests skip gracefully if `pdfinfo` isn't
  present in the environment running `npm test` (mirrors
  `estimateAudioDurationSeconds`'s soft-fallback treatment of a missing
  ffprobe).
- [x] 4.2 `tests/pdf-rasterize.test.mjs`: 3 tests for
  `rasterizePdfToImages` directly — multi-page ordering/PNG validity,
  single-page naming, `PDF_TOO_MANY_PAGES` before rendering.
- [x] 4.3 **Changed from the original plan** — no dedicated test asserts
  `ocr`/`chat` resolving to different providers "in the same request":
  since OCR now *is* the `chat` capability (not a separate one), that
  scenario no longer exists in the way originally planned. What the
  analysis-block independence actually requires — extraction and
  analysis able to use different providers in one job — is the same
  pattern already covered by `migrate-batch-transcription-to-edenai`'s
  worker refactor; `pages/api/ocr.js`'s structure mirrors it but has no
  dedicated test of its own beyond the lint/type-level confirmation that
  the analysis block's `resolveOpenRouterConfig` call is untouched.
- [x] 4.4 `tests/edenai.test.mjs`, `tests/edenai-pricing.test.mjs`,
  `tests/edenai-pricing-gate.test.mjs`, `tests/ai-provider-router.test.mjs`
  updated for the four-capability list and the `chat`-owns-ocr-operation
  pricing shape.

## 5. Verification

- [x] 5.0 Live model/architecture comparison (2026-08-30): dedicated
  `ocr/ocr` (google/amazon/microsoft) vs. `ocr/ocr/mistral` vs.
  `chat`/mistral-small-latest, on a real synthetic table document;
  separately, two real attempts at PDF-via-chat, both confirmed rejected
  by Mistral's API. PDF rasterization approach chosen by the user after
  the trade-off was presented explicitly. Full evidence in design.md.
- [x] 5.0.1 Live-called the actual shipped `performOcrEdenAi` (imported
  directly from `lib/edenai-service.js`, not a reimplementation) against
  production EdenAI with a real 2-page synthetic invoice PDF and a real
  PNG — both correct, PDF pages correctly merged into one coherent
  document with no page-break artifacts. Key deleted from scratchpad
  immediately after each of the three uses this round, verified no leak
  via repo-wide grep every time.
- [ ] 5.1 Manual: activate EdenAI for `chat` on a test workspace, upload
  a table-heavy scanned document, confirm the extracted Markdown feeds
  the existing table-schema analysis correctly through the real UI. Not
  yet run — same open-item pattern as the two prior EdenAI migrations in
  this sequence (`migrate-translation-to-edenai`'s task 5.5,
  `migrate-batch-transcription-to-edenai`'s tasks 5.1/5.2).
- [ ] 5.2 Manual: same workspace, scanned-PDF translation flow, confirm
  the OCR-fallback path still produces a correct translated PDF. Not yet
  run.
- [x] 5.3 `npm test` passes (458 tests / 446 pass / 12 skipped / 0
  failed, up from the pre-existing 450/438/12/0 baseline).
- [x] 5.4 `openspec validate migrate-ocr-extraction-to-edenai --strict`
  passes.
