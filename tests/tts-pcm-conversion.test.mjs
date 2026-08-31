import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import {
  mp3ToCanonicalPcm, PCM_SAMPLE_RATE, PCM_CHANNELS, PCM_BITS_PER_SAMPLE,
} from '../lib/tts.js';

const execFileAsync = promisify(execFile);

// mp3ToCanonicalPcm is the one real conversion step both TTS providers'
// PCM output goes through (see openRouterTts/synthesizeSpeechEdenAi) and
// had no dedicated test for either — see migrate-tts-to-edenai/status.md's
// Outstanding section. @ffmpeg-installer/ffmpeg is already an app
// dependency (lib/tts.js's own default ffmpeg path), so — unlike
// poppler's pdfinfo in tests/pdf-rasterize.test.mjs — this never needs a
// graceful skip: the binary is guaranteed present wherever `npm ci` ran.
async function synthesizeTestMp3(durationSeconds) {
  const { stdout } = await execFileAsync(ffmpegInstaller.path, [
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${durationSeconds}`,
    '-codec:a', 'libmp3lame', '-b:a', '64k',
    '-f', 'mp3', 'pipe:1',
  ], { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

test('mp3ToCanonicalPcm converts a real MP3 to raw PCM at the canonical format', async () => {
  const mp3 = await synthesizeTestMp3(1);
  assert.ok(mp3.length > 0, 'synthesized MP3 fixture should not be empty');

  const pcm = await mp3ToCanonicalPcm(mp3);
  assert.ok(Buffer.isBuffer(pcm));
  assert.ok(pcm.length > 0);

  // 16-bit mono at PCM_SAMPLE_RATE => PCM_SAMPLE_RATE * 2 bytes/second.
  const bytesPerSecond = PCM_SAMPLE_RATE * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8);
  const expectedBytes = bytesPerSecond * 1; // ~1 second of audio
  // MP3 encoder framing (LAME adds a short priming/padding delay) means
  // this is never byte-exact — allow +/-15% around the expected size.
  assert.ok(
    Math.abs(pcm.length - expectedBytes) / expectedBytes < 0.15,
    `expected close to ${expectedBytes} bytes for 1s of PCM, got ${pcm.length}`,
  );
});

test('mp3ToCanonicalPcm output duration scales with input duration', async () => {
  const shortMp3 = await synthesizeTestMp3(1);
  const longMp3 = await synthesizeTestMp3(3);

  const shortPcm = await mp3ToCanonicalPcm(shortMp3);
  const longPcm = await mp3ToCanonicalPcm(longMp3);

  // Roughly 3x the audio should produce roughly 3x the PCM bytes.
  const ratio = longPcm.length / shortPcm.length;
  assert.ok(ratio > 2.5 && ratio < 3.5, `expected ~3x PCM bytes for 3x duration, got ratio ${ratio}`);
});

// Verified live rather than assumed: ffmpeg's forced `.inputFormat('mp3')`
// is lenient enough with non-MP3 input that it does not error — it
// resolves with an empty buffer instead of throwing. Callers already treat
// a zero-length PCM buffer as "nothing to send" (see openRouterTts's and
// synthesizeSpeechEdenAi's call sites, which check `pcm.length > 0` before
// writing), so this degrades the same way a genuinely silent/empty
// synthesis result would — not a new failure mode this test needs to guard
// against, just documented real behavior instead of an untested assumption.
test('mp3ToCanonicalPcm resolves with an empty buffer for non-MP3 input, does not throw', async () => {
  const pcm = await mp3ToCanonicalPcm(Buffer.from('this is not an mp3 file'));
  assert.ok(Buffer.isBuffer(pcm));
  assert.equal(pcm.length, 0);
});
