import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidEmail, normalizeEmail } from '../lib/email.js';

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  USER.Name+X@Example.COM  '), 'user.name+x@example.com');
});

test('normalizeEmail returns null for invalid raw input', () => {
  assert.equal(normalizeEmail('   '), null);
  assert.equal(normalizeEmail(null), null);
  assert.equal(normalizeEmail(undefined), null);
});

test('isValidEmail validates normalized format', () => {
  assert.equal(isValidEmail(' Person@Example.com '), true);
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(isValidEmail('invalid@'), false);
});
