import test from 'node:test';
import assert from 'node:assert/strict';
import {
  budgetLevel,
  calculateBudgetAvailability,
  normalizeBudgetPatch,
} from '../lib/budget-core.js';

test('workspace and member availability are calculated independently', () => {
  const alice = calculateBudgetAvailability({
    workspaceLimitMicros: 10_000,
    memberLimitMicros: 5_000,
    workspaceCommittedMicros: 7_000,
    workspaceReservedMicros: 500,
    memberCommittedMicros: 1_000,
    memberReservedMicros: 250,
  });
  const bob = calculateBudgetAvailability({
    workspaceLimitMicros: 10_000,
    memberLimitMicros: 5_000,
    workspaceCommittedMicros: 7_000,
    workspaceReservedMicros: 500,
    memberCommittedMicros: 3_000,
    memberReservedMicros: 0,
  });
  assert.equal(alice.workspaceRemainingMicros, 2_500);
  assert.equal(alice.memberRemainingMicros, 3_750);
  assert.equal(alice.effectiveRemainingMicros, 2_500);
  assert.equal(bob.workspaceRemainingMicros, 2_500);
  assert.equal(bob.memberRemainingMicros, 2_000);
  assert.equal(bob.effectiveRemainingMicros, 2_000);
});

test('budget availability includes active reservations and clamps exhausted limits', () => {
  const result = calculateBudgetAvailability({
    workspaceLimitMicros: 1_000,
    workspaceCommittedMicros: 800,
    workspaceReservedMicros: 300,
  });
  assert.equal(result.workspaceRemainingMicros, 0);
  assert.equal(result.effectiveRemainingMicros, 0);
  assert.equal(budgetLevel({ costMicros: 1_100, limitMicros: 1_000 }), 'red');
});

test('budget patch requires an audit reason and cent-aligned workspace limits', () => {
  assert.deepEqual(normalizeBudgetPatch({
    reason: 'Quarterly approval',
    workspaceLimitMicros: 1_230_000,
    member: { userId: 42, monthlyLimitMicros: 456_789 },
  }), {
    reason: 'Quarterly approval',
    workspaceLimitMicros: 1_230_000,
    member: { userId: 42, monthlyLimitMicros: 456_789 },
  });
  assert.throws(() => normalizeBudgetPatch({ workspaceLimitMicros: 1_000_000 }), /reason/i);
  assert.throws(() => normalizeBudgetPatch({ reason: 'x', workspaceLimitMicros: 12_345 }), /whole cents/i);
  assert.deepEqual(normalizeBudgetPatch({ reason: 'remove', member: { userId: 42, monthlyLimitMicros: null } }), {
    reason: 'remove', member: { userId: 42, monthlyLimitMicros: null },
  });
});
