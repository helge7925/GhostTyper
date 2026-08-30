# Capability: OpenRouter AI Provider

## REMOVED Requirements

### Requirement: Single Application-Facing AI Provider

GhostTyper SHALL send every AI workload to OpenRouter, except a capability
a workspace has explicitly routed to another active provider through its
per-capability provider configuration.

#### Scenario: Workspace has not migrated a capability

- **GIVEN** a workspace has not configured another provider for a
  capability
- **WHEN** any AI operation for that capability starts
- **THEN** the outbound inference request targets OpenRouter

#### Scenario: Workspace has migrated a capability

- **GIVEN** a workspace has activated EdenAI for the `translation`
  capability
- **WHEN** a translation request starts
- **THEN** the outbound request targets EdenAI, and OpenRouter is not
  contacted for that capability

**Reason**: OpenRouter is fully decommissioned by this change; every
workload now routes to EdenAI per the `edenai-provider` capability's own
"Single Application-Facing AI Provider" requirement.

### Requirement: Privacy-Enforced Routing

GhostTyper SHALL require zero retention and deny provider data collection
on every OpenRouter inference request.

#### Scenario: Request is constructed

- **WHEN** GhostTyper sends an inference request
- **THEN** its provider preferences require ZDR and deny data collection.

**Reason**: OpenRouter's per-request ZDR flag and catalogue-level
ZDR-only-model filtering have no confirmed EdenAI equivalent. This is not
replaced by an equivalent EdenAI requirement in this change — see this
change's design.md and `add-edenai-provider-foundation`'s Risks section.
The product owner must independently verify EdenAI's data-processing
terms meet whatever bar this requirement was chosen to satisfy before
relying on EdenAI for privacy-sensitive content; this spec does not claim
that verification has happened.

### Requirement: Complete Workload Coverage

GhostTyper SHALL support chat, PDF/image OCR, batch/live STT and TTS
through OpenRouter while preserving existing internal result contracts.

#### Scenario: Existing feature uses OpenRouter

- **WHEN** a user runs any existing AI feature
- **THEN** the feature receives the same normalized application result
  shape from the OpenRouter adapter.

**Reason**: superseded by the `edenai-provider` capability's own
"Complete Workload Coverage" requirement.

### Requirement: No Legacy Runtime Fallback

GhostTyper SHALL NOT fall back to a legacy provider after OpenRouter
activation.

#### Scenario: OpenRouter is unavailable

- **GIVEN** the workspace is activated and OpenRouter fails
- **THEN** the operation fails visibly without sending data to a legacy
  host.

**Reason**: superseded by the `edenai-provider` capability's own "No
Legacy Runtime Fallback" requirement, in which OpenRouter is now the
legacy provider that is never fallen back to.

### Requirement: Capability-Aware Chat Parameters

GhostTyper SHALL only send `temperature`, `response_format` or `stream` on
a chat request when the selected model's catalogue `supported_parameters`
lists that parameter.

#### Scenario: Model does not support response_format

- **GIVEN** a chat call requests `response_format: json_object`
- **WHEN** the selected model's catalogue entry does not list
  `response_format` under `supported_parameters`
- **THEN** the request is sent without `response_format` rather than
  discarding the parameter unconditionally regardless of model support.

**Reason**: specific to OpenRouter's live catalogue signal, which no
longer exists in the codebase. EdenAI's equivalent concern (knowing
whether structured output is safe to request per model) is addressed by
the `edenai-provider` capability's "EdenAI Chat Adapter" requirement's
activation-time probe instead of a per-request catalogue check.

### Requirement: Best-Effort STT Context Hints

GhostTyper SHALL forward configured context-bias terms to OpenRouter as a
best-effort provider-specific hint and SHALL NOT silently discard them.

#### Scenario: Context bias is configured

- **GIVEN** a transcription request has non-empty context-bias terms
- **WHEN** the batch or Vexa-bridge transcription request is built
- **THEN** the terms are attached via the documented provider-options
  passthrough (no catalogue signal confirms per-model support), and a
  batch job additionally records a transcription event and an audit-log
  entry noting the forwarding outcome.

**Reason**: specific to OpenRouter's single-sub-provider (Groq) best-
effort passthrough mechanism, which is removed along with OpenRouter.
Native vocabulary support from EdenAI's STT vendors is recorded as
deferred future work in `migrate-batch-transcription-to-edenai`'s and
`migrate-live-meeting-stt-to-edenai`'s design docs, not carried forward as
an equivalent requirement by this change.

### Requirement: Model-Unavailable Admin Visibility

GhostTyper SHALL make an admin-visible record when a batch job exhausts
its `MODEL_UNAVAILABLE` fallback.

#### Scenario: Fallback to the workspace default also fails

- **GIVEN** neither the requested model nor the workspace default is
  available
- **WHEN** the batch worker gives up with `MODEL_UNAVAILABLE`
- **THEN** an audit-log entry is written in addition to the job's own
  error state, so an admin reviewing the audit log sees the failure.

**Reason**: the underlying mechanism (an audit-log entry on an exhausted
`MODEL_UNAVAILABLE` fallback) is implemented generically in
`lib/transcription-worker.js` and is not OpenRouter-specific — it
continues to fire regardless of which provider raised the error. Retired
here as an `openrouter-provider` requirement because that capability is
retired, not because the behavior itself changes; it is not re-specified
under `edenai-provider` since it was never provider-specific in
implementation.
