import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RETRIEVAL_MODE, RETRIEVAL_MODES, combineRetrievalScopes, normalizeRetrievalMode, partitionRetrievalModes, sanitizeName } from '../lib/knowledge-utils.js';

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

test('partitionRetrievalModes splits focused/full_context and drops off + invalid', () => {
  const { focusedDocumentIds, fullContextDocumentIds } = partitionRetrievalModes([
    { document_id: 1, retrieval_mode: 'focused' },
    { document_id: 2, retrieval_mode: 'full_context' },
    { document_id: 3, retrieval_mode: 'off' },
    { document_id: 4, retrieval_mode: 'bogus' },
    { document_id: 'x', retrieval_mode: 'focused' },
  ]);
  assert.deepEqual(focusedDocumentIds, [1, 4]); // bogus → focused default
  assert.deepEqual(fullContextDocumentIds, [2]);
});

test('combineRetrievalScopes lets full context win over focused duplicates', () => {
  const scope = combineRetrievalScopes([
    { focusedDocumentIds: [1, 2, 'x'], fullContextDocumentIds: [] },
    { focusedDocumentIds: [3], fullContextDocumentIds: [2, 4] },
  ]);

  assert.deepEqual(scope.focusedDocumentIds, [1, 3]);
  assert.deepEqual(scope.fullContextDocumentIds, [2, 4]);
  assert.deepEqual(scope.documentIds, [1, 3, 2, 4]);
});
