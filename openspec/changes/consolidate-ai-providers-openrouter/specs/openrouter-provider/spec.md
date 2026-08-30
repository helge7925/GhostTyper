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

### Requirement: Capability-Aware Chat Parameters

GhostTyper SHALL only send `temperature`, `response_format` or `stream` on a
chat request when the selected model's catalogue `supported_parameters`
lists that parameter.

#### Scenario: Model does not support response_format

- **GIVEN** a chat call requests `response_format: json_object`
- **WHEN** the selected model's catalogue entry does not list
  `response_format` under `supported_parameters`
- **THEN** the request is sent without `response_format` rather than
  discarding the parameter unconditionally regardless of model support.

### Requirement: Best-Effort STT Context Hints

GhostTyper SHALL forward configured context-bias terms to OpenRouter as a
best-effort provider-specific hint and SHALL NOT silently discard them.

#### Scenario: Context bias is configured

- **GIVEN** a transcription request has non-empty context-bias terms
- **WHEN** the batch or Vexa-bridge transcription request is built
- **THEN** the terms are attached via the documented provider-options
  passthrough (no catalogue signal confirms per-model support), and a batch
  job additionally records a transcription event and an audit-log entry
  noting the forwarding outcome.

### Requirement: Model-Unavailable Admin Visibility

GhostTyper SHALL make an admin-visible record when a batch job exhausts its
`MODEL_UNAVAILABLE` fallback.

#### Scenario: Fallback to the workspace default also fails

- **GIVEN** neither the requested model nor the workspace default is
  available
- **WHEN** the batch worker gives up with `MODEL_UNAVAILABLE`
- **THEN** an audit-log entry is written in addition to the job's own error
  state, so an admin reviewing the audit log sees the failure.

