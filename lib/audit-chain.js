import { createHash } from 'node:crypto';

export const AUDIT_ZERO_HASH = '0'.repeat(64);

export function normalizeAuditReason(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, 1000) : null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function isoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error('INVALID_AUDIT_TIMESTAMP');
  return date.toISOString();
}

export function canonicalAuditEntry(row) {
  return JSON.stringify({
    id: String(row.id),
    organization_id: row.organization_id == null ? null : String(row.organization_id),
    user_id: row.user_id == null ? null : String(row.user_id),
    action: row.action,
    target_type: row.target_type ?? null,
    target_id: row.target_id ?? null,
    severity: row.severity || 'info',
    metadata: stableValue(row.metadata || {}),
    created_at: isoTimestamp(row.created_at),
  });
}

export function computeAuditEntryHash(previousHash, row) {
  return createHash('sha256')
    .update(`${previousHash || AUDIT_ZERO_HASH}\n${canonicalAuditEntry(row)}`, 'utf8')
    .digest('hex');
}

export function rechainAuditRows(rows) {
  let previousHash = AUDIT_ZERO_HASH;
  return rows.map((row) => {
    const entryHash = computeAuditEntryHash(previousHash, row);
    const rechained = { ...row, prev_hash: previousHash, entry_hash: entryHash };
    previousHash = entryHash;
    return rechained;
  });
}

export async function lockAuditOrganization(client, organizationId) {
  if (organizationId != null) {
    const locked = await client.query(
      'SELECT id FROM organizations WHERE id = $1 FOR UPDATE',
      [organizationId],
    );
    if (locked.rowCount > 0) return;
  }
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [organizationId == null ? '0' : String(organizationId)]);
}

export async function insertChainedAuditEvent(client, event) {
  await lockAuditOrganization(client, event.organizationId);
  const head = await client.query(
    `SELECT id, entry_hash FROM audit_log
      WHERE organization_id IS NOT DISTINCT FROM $1
      ORDER BY id DESC LIMIT 1`,
    [event.organizationId ?? null],
  );
  let previousHash = head.rows[0]?.entry_hash || AUDIT_ZERO_HASH;
  // During a rolling deployment an older app instance may append a legacy
  // row after the hash columns already exist. Repair that tail while holding
  // the same org lock before chaining the next event.
  if (head.rows[0] && !head.rows[0].entry_hash) {
    previousHash = (await rebaseAuditChain(client, event.organizationId)).headHash;
  }
  const inserted = await client.query(
    `INSERT INTO audit_log
       (user_id, organization_id, action, target_type, target_id, severity, metadata, prev_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     RETURNING id, organization_id, user_id, action, target_type, target_id,
               severity, metadata, created_at`,
    [
      event.userId ?? null,
      event.organizationId ?? null,
      event.action,
      event.targetType ?? null,
      event.targetId ?? null,
      event.severity || 'info',
      JSON.stringify(event.metadata || {}),
      previousHash,
    ],
  );
  const row = inserted.rows[0];
  const entryHash = computeAuditEntryHash(previousHash, row);
  await client.query('UPDATE audit_log SET entry_hash = $2 WHERE id = $1', [row.id, entryHash]);
  return { ...row, prev_hash: previousHash, entry_hash: entryHash };
}

export async function rebaseAuditChain(client, organizationId) {
  await lockAuditOrganization(client, organizationId);
  const result = await client.query(
    `SELECT id, organization_id, user_id, action, target_type, target_id,
            severity, metadata, created_at
       FROM audit_log
      WHERE organization_id IS NOT DISTINCT FROM $1
      ORDER BY id ASC
      FOR UPDATE`,
    [organizationId ?? null],
  );
  const rechainedRows = rechainAuditRows(result.rows);
  for (const row of rechainedRows) {
    await client.query(
      'UPDATE audit_log SET prev_hash = $2, entry_hash = $3 WHERE id = $1',
      [row.id, row.prev_hash, row.entry_hash],
    );
  }
  return {
    rows: result.rows.length,
    headHash: rechainedRows.at(-1)?.entry_hash || AUDIT_ZERO_HASH,
  };
}

export async function backfillAuditChains(client) {
  const organizations = await client.query('SELECT DISTINCT organization_id FROM audit_log ORDER BY organization_id NULLS FIRST');
  let updated = 0;
  for (const { organization_id: organizationId } of organizations.rows) {
    await lockAuditOrganization(client, organizationId);
    const rows = await client.query(
      `SELECT id, organization_id, user_id, action, target_type, target_id,
              severity, metadata, created_at, prev_hash, entry_hash
         FROM audit_log
        WHERE organization_id IS NOT DISTINCT FROM $1
        ORDER BY id ASC FOR UPDATE`,
      [organizationId],
    );
    let previousHash = AUDIT_ZERO_HASH;
    for (const row of rows.rows) {
      const calculated = computeAuditEntryHash(previousHash, row);
      if (!row.prev_hash || !row.entry_hash) {
        await client.query(
          `UPDATE audit_log
              SET prev_hash = COALESCE(prev_hash, $2),
                  entry_hash = COALESCE(entry_hash, $3)
            WHERE id = $1`,
          [row.id, previousHash, calculated],
        );
        updated += 1;
      }
      previousHash = row.entry_hash || calculated;
    }
  }
  return updated;
}

export function verifyAuditChain(rows, options = {}) {
  let previousHash = options.initialPreviousHash ?? AUDIT_ZERO_HASH;
  let previousId = null;
  const errors = [];
  for (const row of rows) {
    if (previousId != null && BigInt(row.id) <= BigInt(previousId)) {
      errors.push({ id: row.id, code: 'ORDER_INVALID' });
    }
    if (row.prev_hash !== previousHash) {
      errors.push({ id: row.id, code: 'PREVIOUS_HASH_MISMATCH' });
    }
    const calculated = computeAuditEntryHash(previousHash, row);
    if (row.entry_hash !== calculated) {
      errors.push({ id: row.id, code: 'ENTRY_HASH_MISMATCH' });
    }
    previousHash = row.entry_hash;
    previousId = row.id;
  }
  if (options.expectedHeadHash && previousHash !== options.expectedHeadHash) {
    errors.push({ id: previousId, code: 'HEAD_HASH_MISMATCH' });
  }
  return { valid: errors.length === 0, errors, headHash: previousHash, rows: rows.length };
}
