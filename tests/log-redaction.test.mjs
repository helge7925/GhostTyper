import test from 'node:test';
import assert from 'node:assert/strict';
import { pseudonymizeEmail } from '../lib/observability.js';

test('pseudonymizeEmail returns deterministic email:sha256:<10> token', () => {
  const a = pseudonymizeEmail('alice@example.com');
  const b = pseudonymizeEmail('  alice@example.com  ');
  const c = pseudonymizeEmail('Alice@example.com');
  assert.match(a, /^email:sha256:[0-9a-f]{10}$/);
  assert.equal(a, b, 'whitespace-trimmed inputs hash identically');
  assert.equal(a, c, 'case-folded inputs hash identically');
});

test('pseudonymizeEmail returns null for unusable input', () => {
  assert.equal(pseudonymizeEmail(null), null);
  assert.equal(pseudonymizeEmail(''), null);
  assert.equal(pseudonymizeEmail('   '), null);
  assert.equal(pseudonymizeEmail(42), null);
});

test('pseudonymizeEmail differentiates between distinct emails', () => {
  const a = pseudonymizeEmail('alice@example.com');
  const b = pseudonymizeEmail('bob@example.com');
  assert.notEqual(a, b);
});
