# Capability: Budget Runtime And Pricing

## ADDED Requirements

### Requirement: Enforced Organization Budgets

GhostTyper SHALL enforce a spending limit per organization budget period.

#### Scenario: Limit reached before start

- **GIVEN** an organization has reached its hard limit for the period
- **WHEN** a user starts a paid operation
- **THEN** GhostTyper refuses to start it and explains the limit.

#### Scenario: Within limit

- **GIVEN** an organization is below its limit
- **WHEN** a user starts a paid operation
- **THEN** the operation proceeds.

### Requirement: Per-Member Budgets

GhostTyper SHALL support a spending limit per organization member.

#### Scenario: Member limit reached

- **GIVEN** a member has reached their personal limit
- **WHEN** that member starts a paid operation
- **THEN** GhostTyper refuses to start it, even if the organization has budget left.

### Requirement: Cost Reservation Before Run

GhostTyper SHALL reserve estimated cost before a run and reconcile it
after completion so concurrent runs cannot jointly overshoot a limit.

#### Scenario: Concurrent runs

- **GIVEN** two runs start at nearly the same time near the limit
- **THEN** the reservations are accounted for both runs and the second is
  refused if the combined estimate exceeds the limit.

#### Scenario: Reconciliation after completion

- **WHEN** a run completes
- **THEN** its reservation is replaced by actual recorded usage.

### Requirement: Durable Budget Stop

GhostTyper SHALL stop a run that exceeds its budget mid-flight using a
durable outbox with backoff.

#### Scenario: Overrun during a run

- **GIVEN** a long run passes its limit while in flight
- **THEN** a stop event is enqueued and the run is stopped.

#### Scenario: Stop delivery fails

- **WHEN** a stop event fails to deliver
- **THEN** it is retried with backoff and escalated rather than looping or being lost.

### Requirement: Versioned Provider Pricing

GhostTyper SHALL store provider prices as versions and allow
per-organization overrides.

#### Scenario: Price change over time

- **GIVEN** a provider price changed
- **THEN** historical runs remain costed at the version effective when they ran.

#### Scenario: Organization override

- **WHEN** an admin sets a price override for the organization
- **THEN** that organization's cost calculations use the override.

### Requirement: Live Cost And Progress

GhostTyper SHALL show accumulating cost and progress while a run is in flight.

#### Scenario: Run in progress

- **WHEN** a paid run is executing
- **THEN** the user sees its progress and the cost accrued so far.
