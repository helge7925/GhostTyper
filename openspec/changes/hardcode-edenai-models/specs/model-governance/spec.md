# Capability: Dynamic Model Governance

## MODIFIED Requirements

### Requirement: Dynamic Catalogue

GhostTyper SHALL obtain production model IDs and capabilities from
OpenRouter's authenticated live catalogue instead of a source-code list.
EdenAI is exempt: its models are hardcoded per the `edenai-provider`
capability's "Hardcoded Per-Capability Model" requirement, not obtained
from a live catalogue.

#### Scenario: Admin opens model settings for OpenRouter

- **WHEN** OpenRouter's catalogue is reachable
- **THEN** all ZDR-compatible models are shown under each compatible
  capability without a deployment.

#### Scenario: Admin opens EdenAI settings

- **WHEN** a workspace admin opens the EdenAI integration screen
- **THEN** no live catalogue is fetched; the model shown per capability
  is the hardcoded value from `EDENAI_HARDCODED_MODEL`, per the
  `edenai-provider` capability
