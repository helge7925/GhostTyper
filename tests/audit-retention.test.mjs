import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuditRetentionPlan } from '../lib/audit-retention.js';
import {
  AUDIT_ZERO_HASH,
  computeAuditEntryHash,
  rechainAuditRows,
  verifyAuditChain,
} from '../lib/audit-chain.js';

function row(id, date, previousHash) {
  const value = {
    id, organization_id: 9, user_id: null, action: `event.${id}`,
    target_type: null, target_id: null, severity: 'info', metadata: {},
    created_at: new Date(date), prev_hash: previousHash,
  };
  value.entry_hash = computeAuditEntryHash(previousHash, value);
  return value;
}

const first = row(1, '2026-01-01Z', AUDIT_ZERO_HASH);
const second = row(2, '2026-06-01Z', first.entry_hash);
const third = row(3, '2026-06-20Z', second.entry_hash);

test('retention plan is a no-op when no rows are older than the cutoff', () => {
  const plan = buildAuditRetentionPlan([first, second, third], '2025-01-01Z');
  assert.equal(plan.prunedRows, 0);
  assert.equal(plan.retained.length, 3);
  assert.equal(plan.priorHead, third.entry_hash);
});

test('positive retention prune rebases retained rows into a valid chain', () => {
  const plan = buildAuditRetentionPlan([first, second, third], '2026-05-01Z');
  assert.equal(plan.prunedRows, 1);
  const rebased = rechainAuditRows(plan.retained);
  assert.equal(rebased[0].prev_hash, AUDIT_ZERO_HASH);
  assert.equal(verifyAuditChain(rebased).valid, true);
  assert.notEqual(rebased.at(-1).entry_hash, plan.priorHead);
});
