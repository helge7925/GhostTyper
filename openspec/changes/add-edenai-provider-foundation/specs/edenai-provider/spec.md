# Capability: EdenAI Provider

## ADDED Requirements

### Requirement: Per-Capability Provider Routing

GhostTyper SHALL resolve the active provider for each AI capability
independently, preferring EdenAI for a capability only once that specific
capability has passed EdenAI activation (enabled, probe/pricing-checked,
and holding a default model), and otherwise using OpenRouter. GhostTyper
SHALL NOT automatically retry a failed operation against the other
provider.

#### Scenario: Workspace activates EdenAI for one capability

- **GIVEN** a workspace has enabled EdenAI and set a default model for the
  `translation` capability only
- **WHEN** a translation request is submitted
- **THEN** it is routed to EdenAI, while chat, OCR, transcription and TTS
  requests continue to route to OpenRouter

#### Scenario: EdenAI enabled but capability not configured

- **GIVEN** EdenAI is enabled for a workspace but no default model is set
  for the `ocr` capability
- **WHEN** an OCR request is submitted
- **THEN** it is routed to OpenRouter, not rejected

#### Scenario: Configured provider fails

- **GIVEN** a capability is routed to EdenAI and the EdenAI call fails
- **WHEN** the failure is not the existing single-retry-against-the-
  workspace-default case already covered by Controlled Model Fallback
- **THEN** the operation fails with an error naming EdenAI, and is never
  silently retried against OpenRouter

#### Scenario: A default model alone does not activate a capability

- **GIVEN** a workspace has enabled EdenAI and set a default model for
  the `ocr` capability via a plain configuration update, but `ocr` has
  never been through EdenAI activation's probe and pricing checks
- **WHEN** an OCR request is submitted
- **THEN** it is routed to OpenRouter, not EdenAI, until `ocr` is
  actually activated

### Requirement: Live EdenAI Catalogue

GhostTyper SHALL obtain EdenAI model and provider availability from
EdenAI's authenticated live catalogue endpoints (`GET /v3/models` for the
`chat` capability, `GET /v3/info` for every other capability) instead of
a source-code list.

#### Scenario: Admin opens EdenAI model settings

- **WHEN** a workspace admin opens the EdenAI allowlist screen and the
  catalogue is reachable
- **THEN** the model list reflects EdenAI's current live catalogue
  without a deployment

#### Scenario: Catalogue fetch fails

- **GIVEN** EdenAI's catalogue endpoints are unreachable
- **WHEN** GhostTyper has a previously cached catalogue less than 24 hours
  old
- **THEN** it serves the stale cached catalogue rather than blocking the
  admin screen, marked as stale

### Requirement: EdenAI Manual Pricing Gate

GhostTyper SHALL block activation of an EdenAI capability for a workspace
until every `(model, operation)` pair it would bill has a versioned price
configured, and SHALL report the specific missing pairs rather than allow
the capability to go live and fail at first paid use.

#### Scenario: Activating with missing pricing

- **GIVEN** an admin attempts to activate EdenAI for `transcription` and no
  price version exists for the selected model's `transcription` operation
- **WHEN** the activation request is submitted
- **THEN** it is rejected with the specific missing `(model, operation)`
  pair named, and the capability is not enabled

#### Scenario: Activating with complete pricing

- **GIVEN** every `(model, operation)` pair the capability would bill
  already has a versioned price
- **WHEN** the activation request is submitted
- **THEN** the capability is probed and, on success, enabled
