import test from 'node:test';
import assert from 'node:assert/strict';
import { parseContextBias, mergeContextBias } from '../lib/context-bias.js';

test('parseContextBias returns [] for empty / non-string input', () => {
  assert.deepEqual(parseContextBias(''), []);
  assert.deepEqual(parseContextBias('   '), []);
  assert.deepEqual(parseContextBias(null), []);
  assert.deepEqual(parseContextBias(undefined), []);
  assert.deepEqual(parseContextBias(42), []);
  assert.deepEqual(parseContextBias({}), []);
});

test('parseContextBias splits on comma, semicolon and newline', () => {
  assert.deepEqual(
    parseContextBias('Acme,Schmidt;Müller\nGmbH'),
    ['Acme', 'Schmidt', 'Müller', 'GmbH'],
  );
});

test('parseContextBias trims whitespace and drops empty entries', () => {
  assert.deepEqual(
    parseContextBias('  Acme  ,, ; \n  Schmidt \n\n'),
    ['Acme', 'Schmidt'],
  );
});

test('parseContextBias deduplicates case-insensitively and keeps first occurrence', () => {
  assert.deepEqual(
    parseContextBias('Acme, ACME, acme, Schmidt'),
    ['Acme', 'Schmidt'],
  );
});

test('parseContextBias treats German umlaut casing case-insensitively', () => {
  // Locale-aware lowercase ensures Ü → ü dedup works.
  assert.deepEqual(
    parseContextBias('Müller, MÜLLER, müller'),
    ['Müller'],
  );
});

test('mergeContextBias accepts strings, arrays, null and undefined', () => {
  assert.deepEqual(mergeContextBias(), []);
  assert.deepEqual(mergeContextBias(null, undefined), []);
  assert.deepEqual(mergeContextBias('Acme', ['Schmidt']), ['Acme', 'Schmidt']);
  assert.deepEqual(mergeContextBias(['Acme'], 'Schmidt;GmbH'), ['Acme', 'Schmidt', 'GmbH']);
});

test('mergeContextBias preserves order of the first occurrence across sources', () => {
  // Org-bias first, then user-bias — org wins on dedup ordering.
  assert.deepEqual(
    mergeContextBias('Org-Term, Shared', 'Shared, User-Term'),
    ['Org-Term', 'Shared', 'User-Term'],
  );
});

test('mergeContextBias deduplicates across sources case-insensitively', () => {
  assert.deepEqual(
    mergeContextBias(['Acme'], ['ACME', 'Schmidt'], 'acme;müller'),
    ['Acme', 'Schmidt', 'müller'],
  );
});

test('mergeContextBias drops empty strings from arrays', () => {
  assert.deepEqual(
    mergeContextBias(['', '   ', 'Acme', null], ['Schmidt', '']),
    ['Acme', 'Schmidt'],
  );
});
