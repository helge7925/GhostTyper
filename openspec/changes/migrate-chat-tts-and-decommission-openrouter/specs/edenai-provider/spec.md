# Capability: EdenAI Provider

## ADDED Requirements

### Requirement: EdenAI Chat Adapter

GhostTyper SHALL route chat-capability operations (analysis, template
generation, text optimization, knowledge preparation) to EdenAI when a
workspace has configured `chat` as its active capability, and SHALL NOT
allow a chat model to be allowlisted until it has passed a structured-
output probe confirming reliable JSON-object and JSON-array responses.

#### Scenario: Model passes structured-output probe before allowlisting

- **GIVEN** an admin attempts to allowlist an EdenAI chat model
- **WHEN** the model returns valid JSON matching the test schema and
  preserves array length on the strict-array probe
- **THEN** it may be allowlisted

#### Scenario: Model fails structured-output probe

- **GIVEN** an admin attempts to allowlist an EdenAI chat model
- **WHEN** the model's probe response is not valid JSON, does not match
  the test schema, or does not preserve array length
- **THEN** the model is rejected from the allowlist with the specific
  failure named

#### Scenario: Analysis JSON contract is preserved

- **GIVEN** EdenAI is the active chat provider for a workspace
- **WHEN** a template-driven analysis or table-extraction request
  completes
- **THEN** the result is normalized into the same JSON shape the
  OpenRouter adapter produces, so downstream template/table-schema code
  needs no changes

### Requirement: EdenAI TTS Adapter

GhostTyper SHALL route TTS synthesis (in-meeting audio injection and
read-aloud) to EdenAI when a workspace has configured `tts` as its active
capability, reusing the existing provider-agnostic PCM normalization
unchanged.

#### Scenario: PCM normalization is unaffected by provider

- **GIVEN** EdenAI is the active TTS provider for a workspace
- **WHEN** a segment is synthesized for in-meeting audio injection or
  read-aloud
- **THEN** the resulting audio is normalized to 22.05 kHz / 16-bit / mono
  by the same local pipeline used for OpenRouter-synthesized audio

### Requirement: Single Application-Facing AI Provider

GhostTyper SHALL send every AI workload to EdenAI once a workspace has
completed migration and OpenRouter has been decommissioned for that
workspace.

#### Scenario: Workspace completes migration

- **GIVEN** every capability's default model is configured on EdenAI for
  a workspace
- **WHEN** the migration-completion transaction runs
- **THEN** OpenRouter is disabled and cleared for that workspace and every
  subsequent AI operation targets EdenAI only

### Requirement: Complete Workload Coverage

GhostTyper SHALL support chat, OCR, batch/live transcription, translation
and TTS through EdenAI, preserving the existing internal result contracts
each capability's callers already depend on.

#### Scenario: Existing feature uses EdenAI after full migration

- **WHEN** a user runs any existing AI feature on a fully migrated
  workspace
- **THEN** the feature receives the same normalized application result
  shape it did when OpenRouter served that capability

### Requirement: No Legacy Runtime Fallback

GhostTyper SHALL NOT fall back to OpenRouter for a fully migrated
workspace, even if EdenAI is temporarily unavailable.

#### Scenario: EdenAI is unavailable post-decommission

- **GIVEN** a workspace has completed migration and OpenRouter has been
  decommissioned
- **WHEN** EdenAI fails
- **THEN** the operation fails visibly without sending data to OpenRouter
