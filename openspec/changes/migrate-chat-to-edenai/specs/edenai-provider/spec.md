# Capability: EdenAI Provider

## MODIFIED Requirements

### Requirement: Hardcoded Per-Capability Model

GhostTyper SHALL use exactly one hardcoded, source-controlled model per
EdenAI capability, chosen through a real comparative evaluation against
production EdenAI before being hardcoded, rather than an admin-selected
model from a live catalogue. A capability with no model yet chosen
SHALL NOT be activatable. The `chat` capability's hardcoded model
SHALL back transcription analysis and template generation identically
to how it already backs translation, OCR, and text optimization —
GhostTyper SHALL NOT resolve a separate model for these operations.
Before `chat` can be activated for a workspace, GhostTyper SHALL verify
that the hardcoded model honors `response_format:{type:'json_object'}`
with a real structural check, not merely that the endpoint responds.

#### Scenario: Admin opens EdenAI settings

- **WHEN** a workspace admin opens the EdenAI integration screen
- **THEN** each capability card shows its hardcoded model name (or "not
  yet configured" for a capability with no model chosen), with no
  catalogue browsing, allowlist, or model dropdown

#### Scenario: Activating a capability with no model chosen yet

- **GIVEN** a capability's hardcoded model is unset
- **WHEN** an admin attempts to activate that capability
- **THEN** activation is rejected with `MODEL_NOT_YET_CONFIGURED`,
  naming the capability

#### Scenario: Activating a capability with a hardcoded model

- **GIVEN** a capability's hardcoded model is set and its pricing row
  exists
- **WHEN** an admin activates that capability
- **THEN** the existing live probe and pricing gate run against the
  hardcoded model exactly as they did against an admin-chosen model
  before this change, and activation succeeds or fails on the same
  grounds as before

#### Scenario: Chat activation is blocked when structured output is not honored

- **GIVEN** the hardcoded `chat` model does not return valid,
  correctly-shaped JSON when asked with
  `response_format:{type:'json_object'}`
- **WHEN** an admin attempts to activate `chat`
- **THEN** activation fails with `CAPABILITY_PROBE_FAILED`, distinct
  from a plain-text-response failure — transcription analysis and
  template generation both depend on this contract, not only the
  plain-text check alone would have validated

#### Scenario: Transcription analysis routes through the active chat provider

- **GIVEN** a workspace has activated EdenAI for `chat`
- **WHEN** a transcription (uploaded file, OCR document, or manually
  re-run analysis) is analyzed against a template
- **THEN** the analysis is performed via EdenAI's hardcoded chat model,
  using the exact same prompt and structured-output contract the
  OpenRouter path already used, with no per-request model override

#### Scenario: Template generation routes through the active chat provider

- **GIVEN** a workspace has activated EdenAI for `chat`
- **WHEN** a user generates a new analysis template from a goal
  description
- **THEN** the generated template's prompt text is produced via EdenAI's
  hardcoded chat model as plain natural-language instruction text, not
  as JSON or a code-fenced block

#### Scenario: Each capability independently resolves its own provider

- **GIVEN** a workspace has activated EdenAI for `transcription` but not
  for `chat` (or vice versa)
- **WHEN** an uploaded-file transcription job runs both its
  speech-to-text step and its analysis step
- **THEN** each step resolves its own provider independently — one may
  run on EdenAI while the other runs on OpenRouter within the same job,
  with no cross-contamination between the two capability decisions
