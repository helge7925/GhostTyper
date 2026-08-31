# Capability: Budget Runtime

## MODIFIED Requirements

### Requirement: Dynamic Provider Pricing

GhostTyper SHALL create versioned prices for allowed models of any active
AI provider and SHALL use that provider's reported cost as the committed
amount when the provider reports one.

#### Scenario: Paid request completes

- **WHEN** the active provider for that operation returns actual usage
  cost
- **THEN** the budget reservation is reconciled to that USD amount.

#### Scenario: Price cannot be normalized

- **GIVEN** a model has no supported price unit and no admin override
- **WHEN** an admin attempts to allowlist it
- **THEN** GhostTyper rejects the update to preserve budget enforcement.

#### Scenario: EdenAI price has no automatic source

- **GIVEN** EdenAI exposes no live pricing-catalogue API
- **WHEN** an admin allowlists or activates an EdenAI model
- **THEN** its versioned price must already exist as a manually entered
  admin override, or the update is rejected per the EdenAI Manual Pricing
  Gate requirement.
