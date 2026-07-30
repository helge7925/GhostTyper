# Tasks: Port Tamper-Evident Audit Trail

## 1. Schema

- [ ] Add `prev_hash` / `entry_hash` to `audit_log` (additive).
- [ ] Add the org-scoped chain index.
- [ ] Verify `initDatabase()` stays idempotent.

## 2. Chain Core

- [ ] Port `lib/audit-chain.js` unchanged.
- [ ] Wire chaining into the existing audit write path.
- [ ] Compute the chain inside the insert transaction to avoid races.
- [ ] Chain the first entry of an organization from the zero hash.

## 3. Verification

- [ ] Implement chain verification reporting the first broken link.
- [ ] Anchor verification at the oldest surviving chained entry.
- [ ] Ignore legacy pre-chain rows with NULL hashes.

## 4. Export

- [ ] Port `lib/audit-csv.js` and `lib/audit-export.js`.
- [ ] Port `pages/api/audit-log/export.js` (admin-only).

## 5. Retention

- [ ] Port `lib/audit-retention.js`.
- [ ] Confirm verification still passes after retention removes entries.

## 6. UI

- [ ] Add export + verification affordances to `pages/audit.js`.
- [ ] Use current UI primitives (post-sprezzatura tokens/components).

## 7. i18n

- [ ] Add audit export/verification strings to `messages/de.json`.
- [ ] Add the same keys to `messages/en.json`.

## 8. Verification

- [ ] Port `tests/audit-chain.test.mjs`, `audit-export.test.mjs`,
      `audit-retention.test.mjs`.
- [ ] `npm run lint`.
- [ ] `npm test`.
- [ ] `npm run build`.
- [ ] PostgreSQL smoke: tamper with a row and confirm verification fails
      at the expected position.
