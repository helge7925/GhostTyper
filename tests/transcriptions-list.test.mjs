import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscriptionsListParams } from '../lib/transcriptions-list.js';

test('parseTranscriptionsListParams applies defaults', () => {
  const parsed = parseTranscriptionsListParams({});
  assert.equal(parsed.search, '');
  assert.equal(parsed.scope, 'name');
  assert.equal(parsed.limit, 200);
  assert.equal(parsed.offset, 0);
});

test('parseTranscriptionsListParams clamps values and normalizes scope', () => {
  const parsed = parseTranscriptionsListParams({
    search: '  Projektbericht  ',
    scope: 'FULL',
    limit: '9999',
    offset: '-5',
  });

  assert.equal(parsed.search, 'Projektbericht');
  assert.equal(parsed.scope, 'full');
  assert.equal(parsed.limit, 500);
  assert.equal(parsed.offset, 0);
});

test('parseTranscriptionsListParams handles array query values', () => {
  const parsed = parseTranscriptionsListParams({
    search: ['alpha', 'beta'],
    scope: ['name'],
    limit: ['20'],
    offset: ['40'],
  });

  assert.equal(parsed.search, 'alpha');
  assert.equal(parsed.scope, 'name');
  assert.equal(parsed.limit, 20);
  assert.equal(parsed.offset, 40);
});
