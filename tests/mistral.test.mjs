import test from 'node:test';
import assert from 'node:assert/strict';
import { MISTRAL_LIVE_TRANSCRIPTION_MODEL, normalizeMistralConfig } from '../lib/mistral.js';

test('MISTRAL_LIVE_TRANSCRIPTION_MODEL is the realtime model, not the batch/async one', () => {
  assert.equal(MISTRAL_LIVE_TRANSCRIPTION_MODEL, 'voxtral-mini-transcribe-realtime-2602');
});

test('normalizeMistralConfig defaults to no api key', () => {
  const normalized = normalizeMistralConfig();
  assert.equal(normalized.apiKey, null);
  assert.equal(normalized.schemaVersion, 1);
});

test('normalizeMistralConfig trims the api key and drops blank/whitespace-only values', () => {
  assert.equal(normalizeMistralConfig({ apiKey: '  secret-key  ' }).apiKey, 'secret-key');
  assert.equal(normalizeMistralConfig({ apiKey: '   ' }).apiKey, null);
  assert.equal(normalizeMistralConfig({ apiKey: '' }).apiKey, null);
  assert.equal(normalizeMistralConfig({}).apiKey, null);
});
