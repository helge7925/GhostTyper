import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDefaultTemplate } from '../lib/constants.js';

test('normalizeDefaultTemplate allows transcription built-ins and rejects prep-only templates', () => {
  assert.equal(normalizeDefaultTemplate('generic'), 'generic');
  assert.equal(normalizeDefaultTemplate('meeting'), 'meeting');
  assert.equal(normalizeDefaultTemplate('aufmass'), 'aufmass');
  assert.equal(normalizeDefaultTemplate('knowledge_graph'), 'generic');
  assert.equal(normalizeDefaultTemplate('mindmap'), 'generic');
});

test('normalizeDefaultTemplate keeps custom templates and falls back to generic', () => {
  assert.equal(normalizeDefaultTemplate('custom-42'), 'custom-42');
  assert.equal(normalizeDefaultTemplate('unknown-template'), 'generic');
  assert.equal(normalizeDefaultTemplate(''), 'generic');
});
