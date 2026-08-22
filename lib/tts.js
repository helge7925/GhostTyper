/** OpenRouter TTS with canonical PCM normalization for WAV streaming. */
import { Readable } from 'stream';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { logError, logWarn } from './observability';
import { safeFetch } from './network-guard';
import { getOpenRouterGeneration, OPENROUTER_BASE_URL, openRouterHeaders } from './openrouter';

const OPENROUTER_TTS_URL = `${OPENROUTER_BASE_URL}/audio/speech`;
const TTS_HTTP_TIMEOUT_MS = Number.parseInt(process.env.TTS_HTTP_TIMEOUT_MS, 10) || 30_000;
// Transient-failure retry for 429, 5xx and network errors.
// or 5xx under load; without a short backoff the affected sentence's
// audio is silently lost. We retry only on transient statuses + network
// aborts — permanent 4xx (bad model / bad voice / missing key) fail fast.
const TTS_MAX_ATTEMPTS = Number.parseInt(process.env.TTS_MAX_ATTEMPTS, 10) || 3;
const TTS_RETRY_BASE_MS = Number.parseInt(process.env.TTS_RETRY_BASE_MS, 10) || 500;

// Canonical audio format emitted to the browser. Keeping this
// in one place so the WAV header builder stays in lockstep with what we
// actually request.
export const PCM_SAMPLE_RATE = 22050;
export const PCM_CHANNELS = 1;
export const PCM_BITS_PER_SAMPLE = 16;

/**
 * Returns the optional operator-wide voice. Organization configuration is
 * always preferred by callers and validated during activation.
 */
export function pickVoiceForLanguage(language) {
  if (process.env.OPENROUTER_TTS_VOICE) return process.env.OPENROUTER_TTS_VOICE;
  return '';
}

/**
 * Generate speech for `text` in `language` and return raw bytes.
 * Format defaults to PCM (lowest TTFA, browser plays directly when
 * concatenated under a WAV header). Pass `format: 'mp3'` only if a
 * future caller needs a sharable file rather than a streamed buffer.
 */
async function mp3ToCanonicalPcm(input) {
  ffmpeg.setFfmpegPath(String(process.env.FFMPEG_PATH || ffmpegInstaller.path || '/usr/bin/ffmpeg'));
  return new Promise((resolve, reject) => {
    const chunks = [];
    const command = ffmpeg(Readable.from([input]))
      .inputFormat('mp3')
      .audioFrequency(PCM_SAMPLE_RATE)
      .audioChannels(PCM_CHANNELS)
      .audioCodec('pcm_s16le')
      .format('s16le')
      .on('error', reject);
    const output = command.pipe();
    output.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    output.on('error', reject);
    output.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

export async function openRouterTts({ text, language, format = 'pcm', apiKey, model, voice, signal = null }) {
  const trimmed = (text || '').trim();
  if (!trimmed) return Buffer.alloc(0);

  const key = apiKey || process.env.OPENROUTER_API_KEY;
  if (!key) {
    const err = new Error('TTS_NO_API_KEY');
    err.code = 'TTS_NO_API_KEY';
    throw err;
  }

  // OpenRouter's speech contract requires a provider-compatible voice.
  if (!model) throw Object.assign(new Error('MODEL_UNAVAILABLE'), { code: 'MODEL_UNAVAILABLE' });
  const selectedVoice = voice || pickVoiceForLanguage(language);
  if (!selectedVoice) throw Object.assign(new Error('TTS_VOICE_REQUIRED'), { code: 'TTS_VOICE_REQUIRED' });
  const upstreamFormat = format === 'pcm' ? 'mp3' : format;
  const body = {
    model,
    input: trimmed,
    voice: selectedVoice,
    response_format: upstreamFormat,
    provider: { zdr: true, data_collection: 'deny' },
  };

  let lastError = null;
  for (let attempt = 1; attempt <= TTS_MAX_ATTEMPTS; attempt++) {
    try {
      // safeFetch enforces the SSRF allow-list + its own timeout, so no
      // manual AbortController is needed here.
      const response = await safeFetch(OPENROUTER_TTS_URL, {
        method: 'POST',
        headers: openRouterHeaders(key, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
        signal,
      }, { timeoutMs: TTS_HTTP_TIMEOUT_MS });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const err = new Error(`OpenRouter TTS failed: ${response.status} ${detail.slice(0, 200)}`);
        err.code = 'TTS_UPSTREAM_ERROR';
        err.status = response.status;
        throw err;
      }

      const upstreamAudio = Buffer.from(await response.arrayBuffer());
      const audio = format === 'pcm' ? await mp3ToCanonicalPcm(upstreamAudio) : upstreamAudio;
      audio.providerRequestId = response.headers.get('x-generation-id')
        || response.headers.get('x-request-id')
        || response.headers.get('request-id')
        || null;
      if (audio.providerRequestId) {
        const generation = await getOpenRouterGeneration(key, audio.providerRequestId).catch(() => null);
        if (Number.isFinite(Number(generation?.total_cost ?? generation?.usage))) {
          audio.usage = { cost: Number(generation.total_cost ?? generation.usage) };
        }
      }
      return audio;
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      // Decide whether this failure is worth retrying. 429 (rate limit)
      // and 5xx are transient; a network abort (timeout) likewise. Any
      // other 4xx (bad model, bad voice, auth) is permanent — fail fast.
      const status = error.status;
      const isTransient =
        status === 429 ||
        (typeof status === 'number' && status >= 500) ||
        error.name === 'AbortError' ||
        error.code === 'ABORT_ERR' ||
        (!status && error.code !== 'TTS_NO_API_KEY'); // network-level error
      if (!isTransient || attempt === TTS_MAX_ATTEMPTS) {
        logError('tts.openrouter_failed', error, {
          textLength: trimmed.length, language, attempt, status,
        });
        throw error;
      }
      // Exponential backoff with a little jitter: 0.5s, 1s, 2s …
      const delay = TTS_RETRY_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 200);
      logWarn('tts.openrouter_retry', { attempt, status, delayMs: delay, language });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' }));
          }, { once: true });
        }
      });
    }
  }
  // Unreachable in practice (loop either returns or throws), but keep the
  // contract explicit for callers/linters.
  throw lastError || new Error('OpenRouter TTS failed after retries');
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
 * Quick byte-count helper for diagnostics.
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
