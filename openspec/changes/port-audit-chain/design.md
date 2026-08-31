# Design: Port Tamper-Evident Audit Trail

## Source

Downstream `romaco-scriptor`, ~618 LOC:

- `lib/audit-chain.js` — stable value hashing + chain computation
- `lib/audit-csv.js` — CSV serialization
- `lib/audit-export.js` — export orchestration
- `lib/audit-retention.js` — retention policy
- `pages/api/audit-log/export.js`
- Tests: `audit-chain`, `audit-export`, `audit-retention`

`lib/audit-chain.js` imports only `node:crypto` and has no
customer-specific references — it ports unchanged.

## Schema Delta

Two additive columns on the existing `audit_log`, plus indexes:

```
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_hash  CHAR(64);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entry_hash CHAR(64);
CREATE INDEX IF NOT EXISTS idx_audit_log_org_chain ON audit_log(organization_id, id);
```

Upstream `audit_log` already has `organization_id`, so no further
migration is required.

## Chaining

`entry_hash = H(stableValue(entry fields) || prev_hash)`, where the first
entry of an organization chains from `AUDIT_ZERO_HASH`. `stableValue`
sorts object keys and drops `undefined` so hashing is deterministic
regardless of JSON key order.

Chaining happens on the existing audit write path, inside the same
transaction as the insert, so a concurrent writer cannot interleave and
produce two entries claiming the same predecessor.

## Backward Compatibility

Rows written before this change have `NULL` hashes. Verification starts at
the first row that has an `entry_hash` and treats earlier rows as
out-of-scope legacy history rather than a break.

## Retention Interaction

Removing the oldest entries necessarily removes chain links. Verification
therefore anchors at the oldest *surviving* chained entry rather than
requiring an unbroken chain back to the zero hash.

## Files Changed

- `lib/audit-chain.js`, `audit-csv.js`, `audit-export.js`,
  `audit-retention.js` (new, ported)
- `lib/db-init.js` (two additive columns + index)
- the existing audit write helper
- `pages/api/audit-log/export.js` (new, ported)
- `pages/audit.js` (export + verify affordances)
- `messages/de.json`, `messages/en.json`
- `tests/audit-chain.test.mjs`, `audit-export.test.mjs`,
  `audit-retention.test.mjs`

## Risks

- Touches `lib/db-init.js`, as do `port-budget-runtime` and
  `port-mobile-field-mode`.
- Chaining must be inside the insert transaction, otherwise concurrent
  audit writes race and produce a forked chain.
