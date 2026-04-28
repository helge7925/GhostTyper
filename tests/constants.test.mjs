import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnalysisTemplate, normalizeDefaultTemplate } from '../lib/constants.js';

test('normalizeDefaultTemplate allows transcription built-ins and rejects unknown templates', () => {
  assert.equal(normalizeDefaultTemplate('generic'), 'generic');
  assert.equal(normalizeDefaultTemplate('meeting'), 'meeting');
  assert.equal(normalizeDefaultTemplate('aufmass'), 'aufmass');
  assert.equal(normalizeDefaultTemplate('data_table'), 'generic');
});

test('normalizeDefaultTemplate keeps custom templates and falls back to generic', () => {
  assert.equal(normalizeDefaultTemplate('custom-42'), 'custom-42');
  assert.equal(normalizeDefaultTemplate('unknown-template'), 'generic');
  assert.equal(normalizeDefaultTemplate(''), 'generic');
});

test('normalizeAnalysisTemplate allows runtime templates and rejects unknown templates', () => {
  assert.equal(normalizeAnalysisTemplate('generic'), 'generic');
  assert.equal(normalizeAnalysisTemplate('meeting'), 'meeting');
  assert.equal(normalizeAnalysisTemplate('aufmass'), 'aufmass');
  assert.equal(normalizeAnalysisTemplate('data_table'), 'data_table');
  assert.equal(normalizeAnalysisTemplate('custom-42'), 'custom-42');
  assert.equal(normalizeAnalysisTemplate('unknown-template'), 'generic');
});
