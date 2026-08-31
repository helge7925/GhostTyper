import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIT_ZERO_HASH,
  computeAuditEntryHash,
  normalizeAuditReason,
  insertChainedAuditEvent,
  verifyAuditChain,
} from '../lib/audit-chain.js';

function chainedRows(count = 3) {
  const rows = [];
  let previous = AUDIT_ZERO_HASH;
  for (let index = 1; index <= count; index += 1) {
    const row = {
      id: index,
      organization_id: 7,
      user_id: 3,
      action: `event.${index}`,
      target_type: 'document',
      target_id: String(index),
      severity: 'info',
      metadata: { nested: { b: index, a: true } },
      created_at: new Date(`2026-06-30T10:00:0${index}.000Z`),
      prev_hash: previous,
    };
    row.entry_hash = computeAuditEntryHash(previous, row);
    rows.push(row);
    previous = row.entry_hash;
  }
  return rows;
}

test('audit chain verifies unchanged rows and stable nested metadata ordering', () => {
  const rows = chainedRows();
  assert.equal(verifyAuditChain(rows).valid, true);
  const reorderedMetadata = { ...rows[0], metadata: { nested: { a: true, b: 1 } } };
  assert.equal(computeAuditEntryHash(AUDIT_ZERO_HASH, reorderedMetadata), rows[0].entry_hash);
});

test('chained insert locks organization before reading head and hashes reserved DB identity', async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql.replace(/\s+/g, ' ').trim());
      if (sql.includes('SELECT id FROM organizations')) return { rowCount: 1, rows: [{ id: 7 }] };
      if (sql.includes('SELECT id, entry_hash')) return { rowCount: 0, rows: [] };
      if (sql.includes('INSERT INTO audit_log')) {
        return {
          rowCount: 1,
          rows: [{
            id: '91', organization_id: '7', user_id: null, action: 'created',
            target_type: null, target_id: null, severity: 'info', metadata: {},
            created_at: new Date('2026-06-30T12:00:00Z'),
          }],
        };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const inserted = await insertChainedAuditEvent(client, { organizationId: 7, action: 'created' });
  assert.match(calls[0], /organizations.*FOR UPDATE/);
  assert.match(calls[1], /SELECT id, entry_hash/);
  assert.match(calls[2], /INSERT INTO audit_log/);
  assert.match(calls[3], /UPDATE audit_log SET entry_hash/);
  assert.equal(inserted.id, '91');
  assert.equal(inserted.prev_hash, AUDIT_ZERO_HASH);
});

test('chained insert repairs a legacy unhashed tail before appending', async () => {
  const legacy = {
    id: '1', organization_id: '7', user_id: null, action: 'legacy.plain',
    target_type: null, target_id: null, severity: 'info', metadata: { legacy: true },
    created_at: new Date('2026-06-30T11:00:00Z'), prev_hash: null, entry_hash: null,
  };
  const calls = [];
  const client = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push(normalized);
      if (sql.includes('SELECT id FROM organizations')) return { rowCount: 1, rows: [{ id: 7 }] };
      if (sql.includes('ORDER BY id DESC LIMIT 1')) return { rowCount: 1, rows: [{ id: legacy.id, entry_hash: legacy.entry_hash }] };
      if (sql.includes('ORDER BY id ASC') && sql.includes('FOR UPDATE')) return { rowCount: 1, rows: [{ ...legacy }] };
      if (sql.includes('UPDATE audit_log SET prev_hash')) {
        legacy.prev_hash = params[1];
        legacy.entry_hash = params[2];
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('INSERT INTO audit_log')) {
        return {
          rowCount: 1,
          rows: [{
            id: '2', organization_id: '7', user_id: null, action: 'new.chained',
            target_type: null, target_id: null, severity: 'info', metadata: {},
            created_at: new Date('2026-06-30T12:00:00Z'),
          }],
        };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const inserted = await insertChainedAuditEvent(client, { organizationId: 7, action: 'new.chained' });
  assert.equal(legacy.prev_hash, AUDIT_ZERO_HASH);
  assert.equal(inserted.prev_hash, legacy.entry_hash);
  assert.ok(calls.findIndex((sql) => sql.includes('ORDER BY id ASC')) < calls.findIndex((sql) => sql.includes('INSERT INTO audit_log')));
});

test('audit reasons are trimmed, bounded and preserve explicit absence', () => {
  assert.equal(normalizeAuditReason('  approved change  '), 'approved change');
  assert.equal(normalizeAuditReason('   '), null);
  assert.equal(normalizeAuditReason(null), null);
  assert.equal(normalizeAuditReason('x'.repeat(1200)).length, 1000);
});

test('audit chain detects row tampering, non-tail deletion and reordering', () => {
  const rows = chainedRows();
  assert.equal(verifyAuditChain(rows.map((row, index) => index === 1 ? { ...row, action: 'tampered' } : row)).valid, false);
  assert.equal(verifyAuditChain([rows[0], rows[2]]).valid, false);
  assert.equal(verifyAuditChain([rows[1], rows[0], rows[2]]).valid, false);
});
