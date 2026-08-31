# Capability: Tamper-Evident Audit Trail

## ADDED Requirements

### Requirement: Hash-Chained Audit Entries

GhostTyper SHALL chain audit entries by hash, scoped per organization, so
that modification of past entries is detectable.

#### Scenario: New entry is chained

- **WHEN** an auditable action is recorded
- **THEN** the entry stores its own hash and the previous entry's hash for
  that organization.

#### Scenario: First entry in a chain

- **GIVEN** an organization has no prior audit entries
- **WHEN** the first entry is written
- **THEN** it chains from the defined zero hash.

### Requirement: Chain Verification

GhostTyper SHALL verify an organization's audit chain and report the first
broken link.

#### Scenario: Intact chain

- **WHEN** an admin verifies an unmodified chain
- **THEN** verification reports the chain as intact.

#### Scenario: Modified historical entry

- **GIVEN** a past audit row was altered in the database
- **WHEN** an admin verifies the chain
- **THEN** verification fails and identifies where the chain breaks.

#### Scenario: Pre-existing unchained rows

- **GIVEN** audit rows written before chaining was introduced
- **THEN** they do not cause verification of the new chain to fail.

### Requirement: Audit Export

GhostTyper SHALL let an admin export audit history as CSV.

#### Scenario: Admin exports audit history

- **WHEN** an admin requests a CSV export
- **THEN** the export contains the audit entries for their organization.

#### Scenario: Non-admin requests export

- **WHEN** a user without admin rights requests the export
- **THEN** the request is rejected.

### Requirement: Audit Retention

GhostTyper SHALL support a configurable audit retention policy.

#### Scenario: Retention removes old entries

- **GIVEN** a retention policy is configured
- **WHEN** retention runs
- **THEN** entries older than the policy are removed.

#### Scenario: Verification after retention

- **WHEN** retention has removed the oldest entries
- **THEN** the remaining chain still verifies.
