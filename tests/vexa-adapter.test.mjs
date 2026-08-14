import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMeetingUrl, mapVexaTranscriptToGhostTyper, getTranscript } from '../lib/api/vexa.js';

// Google hard-blocks meeting bots on Meet (operator-verified, July 2026: the
// Vexa bot lands on a dedicated rejection page, not a CAPTCHA). Meet was
// removed from the outbound bot-start path — parseMeetingUrl() must no
// longer recognise Meet links as a bot-startable platform. A pasted Meet
// URL now falls through to the "unsupported" (null) case, same as any
// other unrecognised meeting link; the redirect-to-tab-audio hint lives
// client-side in components/MeetingStartForm.js.
test('parseMeetingUrl no longer recognises Google Meet URLs (redirect/unsupported case)', () => {
  assert.equal(parseMeetingUrl('https://meet.google.com/abc-defg-hij'), null);
  assert.equal(parseMeetingUrl('https://meet.google.com/ABC-DEFG-HIJ'), null);
});

// Read-side tolerance: functions that act on an *existing* meeting row
// (stop bot, fetch transcript, post chat, etc.) take whatever platform
// string is stored on the row and pass it straight through to Vexa — there
// is no allow-list gate inside the adapter. That must stay true so a
// historic transcription with meeting_platform='google_meet' (created
// before this change) can still be read/managed. We can't hit a real Vexa
// server in this suite, but we can prove there's no platform-specific
// rejection: with no baseUrl configured, every platform value — including
// the historic 'google_meet' one — fails identically on the baseUrl guard,
// never on the platform itself.
test('getTranscript applies no platform allow-list (historic google_meet rows stay readable)', async () => {
  for (const platform of ['google_meet', 'teams', 'zoom', 'nextcloud_talk']) {
    await assert.rejects(
      () => getTranscript({ baseUrl: undefined, apiKey: 'x' }, { platform, nativeMeetingId: 'abc' }),
      /Vexa baseUrl is not configured/,
      `platform=${platform} should fail on the missing-baseUrl guard, not be rejected for its platform value`,
    );
  }
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

test('parseMeetingUrl recognises modern Nextcloud Talk URLs', () => {
  const result = parseMeetingUrl('https://cloud.example.com/call/abc123def');
  assert.equal(result.platform, 'nextcloud_talk');
  assert.equal(result.nativeMeetingId, 'abc123def');
  assert.equal(result.nextcloudHost, 'cloud.example.com');
});

test('parseMeetingUrl recognises legacy Nextcloud Talk URLs (index.php)', () => {
  const result = parseMeetingUrl('https://cloud.example.com/index.php/call/Tk2024xyz');
  assert.equal(result.platform, 'nextcloud_talk');
  assert.equal(result.nativeMeetingId, 'Tk2024xyz');
  assert.equal(result.nextcloudHost, 'cloud.example.com');
});

test('parseMeetingUrl recognises scheme-less Nextcloud Talk URLs', () => {
  const modern = parseMeetingUrl('cloud.example.com/call/abc123def');
  assert.equal(modern.platform, 'nextcloud_talk');
  assert.equal(modern.nativeMeetingId, 'abc123def');
  assert.equal(modern.nextcloudHost, 'cloud.example.com');

  const legacy = parseMeetingUrl('cloud.example.com/index.php/call/Tk2024xyz');
  assert.equal(legacy.platform, 'nextcloud_talk');
  assert.equal(legacy.nativeMeetingId, 'Tk2024xyz');
  assert.equal(legacy.nextcloudHost, 'cloud.example.com');
});

test('parseMeetingUrl ignores generic /call paths without a token', () => {
  // Path component must be /call/<6+ alphanumeric>; `/call` alone or
  // `/some-call` must NOT trigger the Talk branch.
  assert.equal(parseMeetingUrl('https://example.com/call'), null);
  assert.equal(parseMeetingUrl('https://example.com/calling/team'), null);
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
