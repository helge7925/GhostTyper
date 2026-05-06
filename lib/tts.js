/**
 * Voxtral TTS wrapper for the live-translation companion-tab feature.
 *
 * Endpoint: POST https://api.mistral.ai/v1/audio/speech
 * Model:    voxtral-tts-latest (Mistral, ~90 ms model latency, ~0.8 s
 *           TTFA for PCM, ~1.5–2 s for MP3 — see
 *           https://mistral.ai/news/voxtral-tts).
 *
 * The TTS-stream API route in `pages/api/transcriptions/[id]/audio.js`
 * concatenates per-segment PCM buffers behind a single WAV header and
 * pipes them to the browser's <audio> element. Per-call format is PCM
 * 22050 Hz / 16-bit / mono, which matches both Mistral's expected output
 * and what `<audio>` plays back without re-encoding.
 *
 * Voice IDs are best-effort placeholders — Mistral may rename them or
 * add language-specific voices over time. `pickVoiceForLanguage` falls
 * back to a single neutral default if the language is unknown so calls
 * never fail just because we don't yet have a curated voice for that
 * locale.
 */
import { logError } from './observability';

const MISTRAL_TTS_URL = 'https://api.mistral.ai/v1/audio/speech';
const DEFAULT_MODEL = 'voxtral-tts-latest';
const TTS_HTTP_TIMEOUT_MS = Number.parseInt(process.env.TTS_HTTP_TIMEOUT_MS, 10) || 30_000;

// Audio format we ask Mistral for and emit to the browser. Keeping this
// in one place so the WAV header builder stays in lockstep with what we
// actually request.
export const PCM_SAMPLE_RATE = 22050;
export const PCM_CHANNELS = 1;
export const PCM_BITS_PER_SAMPLE = 16;

const VOICE_BY_LANGUAGE = {
  de: 'de_neutral',
  en: 'en_neutral',
  fr: 'fr_neutral',
  es: 'es_neutral',
  it: 'it_neutral',
  pt: 'pt_neutral',
  nl: 'nl_neutral',
};

export function pickVoiceForLanguage(language) {
  if (!language) return 'en_neutral';
  const key = String(language).slice(0, 2).toLowerCase();
  return VOICE_BY_LANGUAGE[key] || 'en_neutral';
}

/**
 * Generate speech for `text` in `language` and return raw bytes.
 * Format defaults to PCM (lowest TTFA, browser plays directly when
 * concatenated under a WAV header). Pass `format: 'mp3'` only if a
 * future caller needs a sharable file rather than a streamed buffer.
 */
export async function voxtralTts({ text, language, format = 'pcm', apiKey }) {
  const trimmed = (text || '').trim();
  if (!trimmed) return Buffer.alloc(0);

  const key = apiKey || process.env.MISTRAL_API_KEY;
  if (!key) {
    const err = new Error('TTS_NO_API_KEY');
    err.code = 'TTS_NO_API_KEY';
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TTS_HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(MISTRAL_TTS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        input: trimmed,
        voice: pickVoiceForLanguage(language),
        response_format: format,
        // Pin to the WAV header parameters so a stitched stream stays
        // valid for the browser <audio> element.
        sample_rate: PCM_SAMPLE_RATE,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const err = new Error(`Voxtral TTS failed: ${response.status} ${detail.slice(0, 200)}`);
      err.code = 'TTS_UPSTREAM_ERROR';
      err.status = response.status;
      throw err;
    }

    const buf = Buffer.from(await response.arrayBuffer());
    return buf;
  } catch (error) {
    logError('tts.voxtral_failed', error, { textLength: trimmed.length, language });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build a 44-byte WAV header for a streaming PCM payload of unknown
 * length. We set `dataSize` to the largest possible 32-bit value so the
 * file appears "infinite" to a browser; modern decoders happily play
 * frames as they arrive instead of seeking to a real size.
 */
export function buildWavHeader({
  sampleRate = PCM_SAMPLE_RATE,
  channels = PCM_CHANNELS,
  bitsPerSample = PCM_BITS_PER_SAMPLE,
} = {}) {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = 0xfffffffe; // streaming sentinel; ~4 GB
  const fileSize = 36 + dataSize;

  const buf = Buffer.alloc(44);
  let off = 0;
  buf.write('RIFF', off); off += 4;
  buf.writeUInt32LE(fileSize, off); off += 4;
  buf.write('WAVE', off); off += 4;
  buf.write('fmt ', off); off += 4;
  buf.writeUInt32LE(16, off); off += 4;            // fmt chunk size
  buf.writeUInt16LE(1, off); off += 2;             // PCM = 1
  buf.writeUInt16LE(channels, off); off += 2;
  buf.writeUInt32LE(sampleRate, off); off += 4;
  buf.writeUInt32LE(byteRate, off); off += 4;
  buf.writeUInt16LE(blockAlign, off); off += 2;
  buf.writeUInt16LE(bitsPerSample, off); off += 2;
  buf.write('data', off); off += 4;
  buf.writeUInt32LE(dataSize, off);
  return buf;
}

/**
 * Quick byte-count helper for usage logging. Voxtral TTS is billed per
 * input character (or per second of generated audio depending on
 * Mistral's pricing model — check `lib/usage.js` MODEL_PRICING for the
 * authoritative unit).
 */
export function estimatePcmDurationSeconds(byteLength, {
  sampleRate = PCM_SAMPLE_RATE,
  channels = PCM_CHANNELS,
  bitsPerSample = PCM_BITS_PER_SAMPLE,
} = {}) {
  if (!byteLength) return 0;
  const bytesPerSecond = (sampleRate * channels * bitsPerSample) / 8;
  return byteLength / bytesPerSecond;
}
