# Capability: EdenAI Provider

## MODIFIED Requirements

### Requirement: Hardcoded Per-Capability Model

GhostTyper SHALL route OCR/document-text extraction through the `chat`
capability's hardcoded model when a workspace has activated `chat`, and
SHALL NOT expose a separate `ocr` capability, activation step, or
hardcoded model. GhostTyper SHALL rasterize a PDF input to one image per
page before extraction, since the hardcoded chat model accepts no PDF
content directly; an image input is sent unchanged. GhostTyper SHALL
leave the subsequent structuring step routed independently, continuing
to use whichever provider is active for the `chat` capability's analysis
call (unchanged by this requirement — see the `migrate-chat-tts-and-
decommission-openrouter` change for when that call site itself migrates).

#### Scenario: Extraction and structuring can use different providers

- **GIVEN** a workspace has activated EdenAI's `chat` capability
- **WHEN** an OCR-with-analysis request is submitted
- **THEN** the raw extraction call targets EdenAI and the structuring
  call targets OpenRouter in the same request, without error

#### Scenario: An image is sent directly

- **GIVEN** EdenAI's `chat` capability is active for a workspace
- **WHEN** an image file (PNG/JPG/WEBP) is submitted for OCR
- **THEN** GhostTyper sends it as a single `image_url` content block in
  one chat message, with no PDF-specific preprocessing

#### Scenario: A PDF is rasterized to images first

- **GIVEN** EdenAI's `chat` capability is active for a workspace
- **WHEN** a PDF is submitted for OCR
- **THEN** GhostTyper rasterizes it to one image per page and sends all
  pages as consecutive `image_url` blocks in a single chat message,
  instructing the model to treat them as one continuous document

#### Scenario: An oversized PDF is rejected before rendering

- **GIVEN** EdenAI's `chat` capability is active for a workspace
- **WHEN** a PDF exceeding the configured page cap is submitted for OCR
- **THEN** GhostTyper rejects the request with a distinct error before
  rasterizing any page, rather than silently truncating the document

#### Scenario: No dedicated OCR capability exists

- **GIVEN** a workspace has activated EdenAI's `chat` capability but not
  any other capability
- **WHEN** an admin views the EdenAI integration panel
- **THEN** no separate "OCR" capability card is shown, and OCR requests
  already route to EdenAI through `chat`

#### Scenario: Downstream structuring pipeline is unaffected

- **GIVEN** EdenAI produced the raw Markdown extraction for a document
- **WHEN** that Markdown is passed to template resolution and table
  analysis
- **THEN** `resolveTemplate`, `normalizeAndValidateTableAnalysis` and
  `normalizeDataTableAnalysis` behave identically to when OpenRouter
  produced the extraction
