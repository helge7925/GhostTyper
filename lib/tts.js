/**
 * Voxtral TTS wrapper for the live-translation companion-tab feature.
 *
 * Endpoint: POST https://api.mistral.ai/v1/audio/speech
 * Model:    voxtral-mini-tts-2603 (Mistral, ~90 ms model latency, ~0.8 s
 *           TTFA for PCM, ~1.5–2 s for MP3 — see
 *           https://mistral.ai/news/voxtral-tts).
 *
 * The TTS-stream API route in `pages/api/transcriptions/[id]/audio.js`
 * concatenates per-segment PCM buffers behind a single WAV header and
 * pipes them to the browser's <audio> element. Per-call format is PCM
 * 22050 Hz / 16-bit / mono, which matches both Mistral's expected output
 * and what `<audio>` plays back without re-encoding.
 *
 * Voice handling: Mistral does not ship language-tagged preset voices.
 * voice_id refers to user-created voices via the /v1/audio/voices API.
 * If MISTRAL_TTS_VOICE_ID is configured we send it; otherwise the field
 * is omitted and Mistral picks its default voice. The `language` param
 * is kept for usage logging + future per-language voice routing.
 */
import { logError } from './observability';
import { safeFetch } from './network-guard';

const MISTRAL_TTS_URL = 'https://api.mistral.ai/v1/audio/speech';
// As of Mistral's Voxtral TTS GA (March 2026), the only documented TTS
// model ID on /v1/audio/speech is `voxtral-mini-tts-2603`. Mistral has
// not (yet) published a `*-latest` alias for TTS — using the dated tag
// avoids the "Invalid model" rejection we got from `voxtral-tts-latest`.
const DEFAULT_MODEL = process.env.MISTRAL_TTS_MODEL || 'voxtral-mini-tts-2603';
// Mistral's TTS endpoint *requires* one of `voice` or `ref_audio` per
// request — its OpenAPI doc claims optional, but the live API rejects
// requests without it ("Either ref_audio or voice must be provided.").
//
// Voxtral-4B-TTS-2603 ships exactly 20 preset voices, derived by
// listing the model card's `voice_embedding/` directory on Hugging
// Face. They come in two groups:
//
//   Language-tagged (native accent for the target language):
//     ar_male  de_male  de_female  es_male  es_female  fr_male
//     fr_female  hi_male  hi_female  it_male  it_female  nl_male
//     nl_female  pt_male  pt_female
//
//   Language-agnostic (English-flavored; can render any language but
//   with an English speaker timbre):
//     casual_male  casual_female  cheerful_female
//     neutral_male  neutral_female
//
// Note the gaps: Arabic only has male, English has no `en_*` variants
// (the casual/neutral set fills that role), `cheerful_male` does not
// exist. The map below honours these gaps explicitly.
const VOICE_BY_LANGUAGE = {
  de: 'de_male',
  en: 'casual_male',
  // Voxtral has no `zh_*` preset (Chinese is supported on the STT side
  // but not yet on TTS as of the March 2026 model). Fall back to the
  // English casual_male — the model is multilingual enough to read
  // Chinese text, but it'll sound English-accented. The meeting-start
  // dialog surfaces this caveat via the `translation.audio.zhFallback`
  // i18n string so hosts know what to expect.
  zh: 'casual_male',
  fr: 'fr_male',
  es: 'es_male',
  it: 'it_male',
  pt: 'pt_male',
  nl: 'nl_male',
  ar: 'ar_male',
  hi: 'hi_male',
};
// Used both when `language` is missing/unknown and when an operator
// explicitly pins a global voice via env. Default keeps the safe
// multilingual English voice from the model's HF code example.
const DEFAULT_VOICE = process.env.MISTRAL_TTS_VOICE || 'casual_male';
const TTS_HTTP_TIMEOUT_MS = Number.parseInt(process.env.TTS_HTTP_TIMEOUT_MS, 10) || 30_000;

// Audio format we ask Mistral for and emit to the browser. Keeping this
// in one place so the WAV header builder stays in lockstep with what we
// actually request.
export const PCM_SAMPLE_RATE = 22050;
export const PCM_CHANNELS = 1;
export const PCM_BITS_PER_SAMPLE = 16;

/**
 * Returns the `voice` preset we send to Mistral for a given language.
 * Resolution order:
 *   1. Operator env override (MISTRAL_TTS_VOICE) — pins one voice for
 *      every translation, useful in single-language deployments.
 *   2. Language-specific mapping from VOICE_BY_LANGUAGE.
 *   3. The English-multilingual fallback `casual_male`.
 */
export function pickVoiceForLanguage(language) {
  if (process.env.MISTRAL_TTS_VOICE) return process.env.MISTRAL_TTS_VOICE;
  if (!language) return DEFAULT_VOICE;
  const key = String(language).slice(0, 2).toLowerCase();
  return VOICE_BY_LANGUAGE[key] || DEFAULT_VOICE;
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

  // Mistral expects field `voice` (not `voice_id` — the OpenAPI doc is
  // misleading on that point) and rejects requests without one.
  try {
    const response = await safeFetch(MISTRAL_TTS_URL, {
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
    }, { timeoutMs: TTS_HTTP_TIMEOUT_MS });

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
