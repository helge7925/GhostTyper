import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMeetingUrl, mapVexaTranscriptToGhostTyper } from '../lib/api/vexa.js';

test('parseMeetingUrl recognises Google Meet URLs', () => {
  const result = parseMeetingUrl('https://meet.google.com/abc-defg-hij');
  assert.deepEqual(result, { platform: 'google_meet', nativeMeetingId: 'abc-defg-hij' });
});

test('parseMeetingUrl normalises Google Meet IDs to lowercase', () => {
  const result = parseMeetingUrl('https://meet.google.com/ABC-DEFG-HIJ');
  assert.equal(result.nativeMeetingId, 'abc-defg-hij');
});

test('parseMeetingUrl extracts Zoom ID and passcode', () => {
  const result = parseMeetingUrl('https://us02web.zoom.us/j/1234567890?pwd=secretToken');
  assert.equal(result.platform, 'zoom');
  assert.equal(result.nativeMeetingId, '1234567890');
  assert.equal(result.passcode, 'secretToken');
});

test('parseMeetingUrl returns null for unknown platforms', () => {
  assert.equal(parseMeetingUrl('https://example.com/some-call'), null);
  assert.equal(parseMeetingUrl(''), null);
  assert.equal(parseMeetingUrl(null), null);
});

test('mapVexaTranscriptToGhostTyper builds text and unique speakers', () => {
  const result = mapVexaTranscriptToGhostTyper({
    segments: [
      { start: 0, end: 1.5, text: 'Hallo zusammen', speaker: 'A' },
      { start: 1.5, end: 3, text: 'Schön, dass ihr da seid.', speaker: 'A' },
      { start: 3, end: 4.2, text: 'Danke!', speaker: 'B' },
    ],
  });
  assert.equal(result.text, 'Hallo zusammen Schön, dass ihr da seid. Danke!');
  assert.equal(result.segments.length, 3);
  assert.equal(result.speakers.length, 2);
  assert.equal(result.speakers[0].id, 'A');
  assert.equal(result.speakers[1].id, 'B');
});

test('mapVexaTranscriptToGhostTyper handles missing fields gracefully', () => {
  const result = mapVexaTranscriptToGhostTyper({});
  assert.equal(result.text, '');
  assert.deepEqual(result.segments, []);
  assert.deepEqual(result.speakers, []);
});

test('mapVexaTranscriptToGhostTyper trims segment text and skips empty', () => {
  const result = mapVexaTranscriptToGhostTyper({
    segments: [
      { start: 0, end: 1, text: '  hello  ', speaker: null },
      { start: 1, end: 2, text: '', speaker: null },
      { start: 2, end: 3, text: 'world', speaker: null },
    ],
  });
  assert.equal(result.text, 'hello world');
  assert.equal(result.segments.length, 3);
  assert.equal(result.speakers.length, 0);
});
