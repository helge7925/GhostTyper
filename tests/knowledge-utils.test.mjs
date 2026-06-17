import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RETRIEVAL_MODE, RETRIEVAL_MODES, normalizeRetrievalMode, sanitizeName } from '../lib/knowledge-utils.js';

test('normalizeRetrievalMode keeps valid modes', () => {
  for (const mode of RETRIEVAL_MODES) {
    assert.equal(normalizeRetrievalMode(mode), mode);
  }
});

test('normalizeRetrievalMode falls back to focused for invalid input', () => {
  assert.equal(normalizeRetrievalMode('bogus'), DEFAULT_RETRIEVAL_MODE);
  assert.equal(normalizeRetrievalMode(undefined), 'focused');
  assert.equal(normalizeRetrievalMode(null), 'focused');
});

test('sanitizeName trims and caps length, empty for blank', () => {
  assert.equal(sanitizeName('  Vertrieb  '), 'Vertrieb');
  assert.equal(sanitizeName(''), '');
  assert.equal(sanitizeName('   '), '');
  assert.equal(sanitizeName('x'.repeat(300)).length, 255);
});
