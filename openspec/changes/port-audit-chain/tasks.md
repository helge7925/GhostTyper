# Tasks: Port Tamper-Evident Audit Trail

## 1. Schema

- [x] Add `prev_hash` / `entry_hash` to `audit_log` (additive).
- [x] Add the org-scoped chain index.
- [ ] Verify `initDatabase()` stays idempotent against disposable PostgreSQL.

## 2. Chain Core

- [x] Port `lib/audit-chain.js` unchanged.
- [x] Wire chaining into the existing audit write path.
- [x] Compute the chain inside the insert transaction to avoid races.
- [x] Chain the first entry of an organization from the zero hash.

## 3. Verification

- [x] Implement chain verification reporting the first broken link.
- [x] Anchor verification at the oldest surviving chained entry.
- [x] Ignore legacy pre-chain rows with NULL hashes.

## 4. Export

- [x] Port `lib/audit-csv.js` and `lib/audit-export.js`.
- [x] Port `pages/api/audit-log/export.js` (admin-only).

## 5. Retention

- [x] Port `lib/audit-retention.js`.
- [x] Confirm verification still passes after retention removes entries.

## 6. UI

- [x] Add export + verification affordances to `pages/audit.js`.
- [x] Use current UI primitives (post-sprezzatura tokens/components).

## 7. i18n

- [x] Add audit export/verification strings to `messages/de.json`.
- [x] Add the same keys to `messages/en.json`.

## 8. Verification

- [x] Port `tests/audit-chain.test.mjs`, `audit-export.test.mjs`,
      `audit-retention.test.mjs`.
- [x] `npm run lint`.
- [x] `npm test`.
- [x] `npm run build`.
- [ ] PostgreSQL smoke: tamper with a row and confirm verification fails
      at the expected position.
