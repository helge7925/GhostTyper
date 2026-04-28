import test from 'node:test';
import assert from 'node:assert/strict';
import { getPrompt } from '../lib/prompts.js';

test('getPrompt resolves data_table prompt in German and English', () => {
  const de = getPrompt('data_table', 'de');
  const en = getPrompt('data_table', 'en');

  assert.ok(de.includes('Datentabelle'));
  assert.ok(en.toLowerCase().includes('data table'));
});
