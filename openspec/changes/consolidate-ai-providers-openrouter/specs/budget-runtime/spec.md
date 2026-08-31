# Capability: OpenRouter Budget Runtime

## MODIFIED Requirements

### Requirement: USD Canonical Currency

GhostTyper SHALL account, display and enforce all budgets and new usage in USD.

#### Scenario: Legacy monetary value is migrated

- **GIVEN** an existing monetary value is stored in EUR
- **WHEN** the USD migration runs
- **THEN** its numeric micro-value is retained and its canonical currency
  becomes USD without foreign-exchange conversion.

### Requirement: Dynamic Provider Pricing

GhostTyper SHALL create versioned prices for allowed OpenRouter models and use
OpenRouter-reported cost as the committed amount.

#### Scenario: Paid request completes

- **WHEN** OpenRouter returns actual usage cost
- **THEN** the budget reservation is reconciled to that USD amount.

#### Scenario: Price cannot be normalized

- **GIVEN** a model has no supported price unit and no admin override
- **WHEN** an admin attempts to allowlist it
- **THEN** GhostTyper rejects the update to preserve budget enforcement.

