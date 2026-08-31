# Capability: OpenRouter AI Provider

## MODIFIED Requirements

### Requirement: Single Application-Facing AI Provider

GhostTyper SHALL send every AI workload to OpenRouter, except a capability
a workspace has explicitly routed to another active provider through its
per-capability provider configuration.

#### Scenario: Workspace has not migrated a capability

- **GIVEN** a workspace has not configured another provider for a
  capability
- **WHEN** any AI operation for that capability starts
- **THEN** the outbound inference request targets OpenRouter

#### Scenario: Workspace has migrated translation

- **GIVEN** a workspace has activated EdenAI's `chat` capability
- **WHEN** a translation request starts (inline text, office document, or
  PDF)
- **THEN** the outbound request targets EdenAI, and OpenRouter is not
  contacted for that request — there is no separate `translation`
  capability to activate; it follows `chat`
