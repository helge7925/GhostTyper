# Capability: Dynamic Model Governance

## ADDED Requirements

### Requirement: Dynamic Catalogue

GhostTyper SHALL obtain production model IDs and capabilities from the
authenticated OpenRouter catalogue instead of source-code lists.

#### Scenario: Admin opens model settings

- **WHEN** the catalogue is reachable
- **THEN** all ZDR-compatible models are shown under each compatible
  capability without a deployment.

### Requirement: Workspace Allowlist And Defaults

GhostTyper SHALL let workspace admins maintain an allowlist and one default
for each AI capability.

#### Scenario: Member selects a model

- **WHEN** a member opens a model selector
- **THEN** only compatible models in the workspace allowlist are available.

#### Scenario: Invalid default is submitted

- **WHEN** an admin selects a default outside the corresponding allowlist
- **THEN** the update is rejected.

### Requirement: Controlled Model Fallback

GhostTyper SHALL retry the workspace default once when a user's selected model
is unavailable and SHALL otherwise fail closed.

#### Scenario: User model disappeared

- **GIVEN** the user model is unavailable and the workspace default is healthy
- **WHEN** the operation is submitted
- **THEN** it is retried once with the workspace default.

#### Scenario: Default disappeared

- **GIVEN** the workspace default is unavailable
- **WHEN** the operation is submitted
- **THEN** GhostTyper returns `MODEL_UNAVAILABLE` and requests admin action.

