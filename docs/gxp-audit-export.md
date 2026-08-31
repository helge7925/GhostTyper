# GxP audit export runbook

Audit entries are linked per organization with SHA-256 hashes over a canonical
representation of the entry. New deployments add and backfill `prev_hash` and
`entry_hash` during database initialization. Writes remain compatible while an
older schema is being rolled out.

## Signing and export

Set `AUDIT_SIGNING_KEY` to a secret with at least 32 random bytes. Users with
`audit.export` can download a ZIP from the audit page. It contains
`audit-trail.csv`, `audit-trail.pdf`, and `manifest.json`. The manifest records
the exported ID range, chain head, and SHA-256 digest and byte size of both
files. With no key configured the manifest explicitly contains `signed:false`.

Never commit or log the signing key. Rotate it through the deployment secret
store and retain the old key for packages that must remain verifiable.

## Verification

Verify an export (the key is read from the environment):

```sh
npm run audit:verify -- --zip audit-example-2026-06-30.zip
```

Verify the live chain for one organization:

```sh
DATABASE_URL=postgresql://... npm run audit:verify -- --org-id 42
```

Exit code `1` indicates a mismatch. A database-only chain detects changed,
reordered, and non-tail deleted entries. Deletion of the current tail cannot be
detected without a trusted external anchor; signed exports provide that anchor
for their recorded range.

## Retention

`npm run retention:apply` honors `audit_retention_days`. For every organization
it records a summary containing cutoff, pruned row count, and the prior chain
head, deletes expired entries, and deterministically rebases retained entries
from the zero hash in the same transaction. Use `--dry-run` to report counts
without changing data.
