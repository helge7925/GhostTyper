# Capability: Dynamic Model Governance

## MODIFIED Requirements

### Requirement: Dynamic Catalogue

GhostTyper SHALL obtain production model IDs and capabilities from each
active provider's authenticated live catalogue instead of a source-code
list.

#### Scenario: Admin opens model settings for OpenRouter

- **WHEN** OpenRouter's catalogue is reachable
- **THEN** all ZDR-compatible models are shown under each compatible
  capability without a deployment.

#### Scenario: Admin opens model settings for EdenAI

- **WHEN** EdenAI's `GET /v3/models`/`GET /v3/info` catalogue is reachable
- **THEN** all currently available models are shown under each compatible
  capability without a deployment, per the `edenai-provider` capability's
  own "Live EdenAI Catalogue" requirement.
