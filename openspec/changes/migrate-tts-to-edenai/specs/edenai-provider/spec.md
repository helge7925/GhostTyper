# Capability: EdenAI Provider

## MODIFIED Requirements

### Requirement: Hardcoded Per-Capability Model

GhostTyper SHALL use exactly one hardcoded, source-controlled model per
EdenAI capability, chosen through a real comparative evaluation against
production EdenAI before being hardcoded, rather than an admin-selected
model from a live catalogue. A capability with no model yet chosen
SHALL NOT be activatable. For TTS specifically, GhostTyper SHALL always
send an explicit voice with every synthesis request — never the
provider's unconfigured default — falling back to a hardcoded default
voice when a workspace has not configured its own.

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

#### Scenario: TTS synthesis without a workspace-configured voice

- **GIVEN** a workspace has activated EdenAI for the `tts` capability but
  has not set a voice in `ttsVoices` for the hardcoded TTS model
- **WHEN** a segment of text is synthesized to speech
- **THEN** the request is sent with the hardcoded default voice, never
  with the `voice` field omitted — omitting it produces garbled or
  incorrect speech for most EdenAI TTS models (see design.md)

#### Scenario: TTS synthesis with a workspace-configured voice

- **GIVEN** a workspace has set its own voice in `ttsVoices` for the
  hardcoded TTS model
- **WHEN** a segment of text is synthesized to speech
- **THEN** the workspace's configured voice is sent instead of the
  hardcoded default
