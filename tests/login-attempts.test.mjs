import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLockoutMs, __testables } from '../lib/login-attempts.js';

test('computeLockoutMs returns 0 below the low threshold', () => {
  for (let i = 0; i < __testables.THRESHOLD_LOW; i++) {
    assert.equal(computeLockoutMs(i), 0);
  }
});

test('computeLockoutMs returns the low window between LOW and MID', () => {
  for (let i = __testables.THRESHOLD_LOW; i < __testables.THRESHOLD_MID; i++) {
    assert.equal(computeLockoutMs(i), __testables.WINDOW_LOW_MS);
  }
});

test('computeLockoutMs returns the mid window between MID and HIGH', () => {
  for (let i = __testables.THRESHOLD_MID; i < __testables.THRESHOLD_HIGH; i++) {
    assert.equal(computeLockoutMs(i), __testables.WINDOW_MID_MS);
  }
});

test('computeLockoutMs returns the high window at and above HIGH', () => {
  assert.equal(computeLockoutMs(__testables.THRESHOLD_HIGH), __testables.WINDOW_HIGH_MS);
  assert.equal(computeLockoutMs(__testables.THRESHOLD_HIGH + 50), __testables.WINDOW_HIGH_MS);
});

test('lockout windows escalate monotonically', () => {
  assert.ok(__testables.WINDOW_LOW_MS < __testables.WINDOW_MID_MS);
  assert.ok(__testables.WINDOW_MID_MS < __testables.WINDOW_HIGH_MS);
});
