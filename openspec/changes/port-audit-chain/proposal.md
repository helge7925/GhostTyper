# Change: Port Tamper-Evident Audit Trail From Downstream

## Why

GhostTyper has an `audit_log` table and an `/audit` page, but entries are
plain rows: anyone with database access can alter or delete history
without leaving a trace. For a self-hosted product sold into regulated or
security-conscious environments, a tamper-evident audit trail is a
procurement question, not a nice-to-have.

Downstream `romaco-scriptor` implements hash chaining over the same table.
`lib/audit-chain.js` is generic — stable value hashing with no
customer-specific or domain-specific coupling — and the schema delta is
only **two additive columns**.

## Decisions Captured

- Audit entries SHALL be hash-chained so that altering or removing a past
  entry is detectable.
- The chain SHALL be scoped per organization.
- GhostTyper SHALL provide a chain verification that reports the first
  broken link.
- Audit history SHALL be exportable as CSV.
- Audit history SHALL support a configurable retention policy.

## What Changes

- Port `lib/audit-chain.js`, `lib/audit-csv.js`, `lib/audit-export.js`,
  `lib/audit-retention.js`.
- Add `prev_hash CHAR(64)` and `entry_hash CHAR(64)` to `audit_log`
  (additive), plus the org-scoped chain index.
- Wire chaining into the existing audit write path.
- Port `pages/api/audit-log/export.js`.
- Add export + verification affordances to the existing `pages/audit.js`.

## Out Of Scope

- Electronic signatures / approval workflows.
- Write-once storage or external notarization of the chain head.
- Changing what is audited today (the set of audited actions is unchanged).

## Success Criteria

- New audit entries carry a valid hash chain per organization.
- Verification detects a modified or deleted historical entry and reports
  where the chain breaks.
- Existing pre-chain rows do not break verification of the new chain.
- Admins can export audit history as CSV.
- Retention removes entries per policy without invalidating verification
  of the remaining chain.
