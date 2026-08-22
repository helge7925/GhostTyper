# Capability: OpenRouter AI Provider

## ADDED Requirements

### Requirement: Single Application-Facing AI Provider

GhostTyper SHALL send active chat, OCR, transcription and speech workloads
only to OpenRouter.

#### Scenario: Activated workspace executes AI work

- **GIVEN** a workspace has activated OpenRouter
- **WHEN** any AI operation starts
- **THEN** the outbound inference request targets OpenRouter and never Cortecs
  or Mistral directly.

### Requirement: Privacy-Enforced Routing

GhostTyper SHALL require zero retention and deny provider data collection on
every OpenRouter inference request.

#### Scenario: Request is constructed

- **WHEN** GhostTyper sends an inference request
- **THEN** its provider preferences require ZDR and deny data collection.

### Requirement: Complete Workload Coverage

GhostTyper SHALL support chat, PDF/image OCR, batch/live STT and TTS through
OpenRouter while preserving existing internal result contracts.

#### Scenario: Existing feature uses OpenRouter

- **WHEN** a user runs any existing AI feature
- **THEN** the feature receives the same normalized application result shape
  from the OpenRouter adapter.

### Requirement: No Legacy Runtime Fallback

GhostTyper SHALL NOT fall back to a legacy provider after OpenRouter activation.

#### Scenario: OpenRouter is unavailable

- **GIVEN** the workspace is activated and OpenRouter fails
- **THEN** the operation fails visibly without sending data to a legacy host.

