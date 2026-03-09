import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEffectiveBudgetLimit } from '../lib/budget-guardrails.js';

test('resolveEffectiveBudgetLimit returns null when no limits are configured', () => {
  assert.equal(resolveEffectiveBudgetLimit({ costLimit: null, memberMonthlyBudgetLimit: null }), null);
  assert.equal(resolveEffectiveBudgetLimit({ costLimit: undefined, memberMonthlyBudgetLimit: undefined }), null);
  assert.equal(resolveEffectiveBudgetLimit({ costLimit: '', memberMonthlyBudgetLimit: '' }), null);
});

test('resolveEffectiveBudgetLimit uses the account limit when member limit is missing', () => {
  assert.equal(resolveEffectiveBudgetLimit({ costLimit: 10, memberMonthlyBudgetLimit: null }), 10);
});

test('resolveEffectiveBudgetLimit uses the member limit when account limit is missing', () => {
  assert.equal(resolveEffectiveBudgetLimit({ costLimit: null, memberMonthlyBudgetLimit: 7.5 }), 7.5);
});

test('resolveEffectiveBudgetLimit picks the smaller limit when both are set', () => {
  assert.equal(resolveEffectiveBudgetLimit({ costLimit: 10, memberMonthlyBudgetLimit: 6 }), 6);
});

test('resolveEffectiveBudgetLimit ignores non-positive limits', () => {
  assert.equal(resolveEffectiveBudgetLimit({ costLimit: 0, memberMonthlyBudgetLimit: null }), null);
  assert.equal(resolveEffectiveBudgetLimit({ costLimit: -5, memberMonthlyBudgetLimit: 8 }), 8);
  assert.equal(resolveEffectiveBudgetLimit({ costLimit: 12, memberMonthlyBudgetLimit: 0 }), 12);
});
