import { readFile, stat, unlink } from 'fs/promises';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { DEFAULT_PROMPTS, getPrompt, OUTPUT_QUALITY_GUARD, TEMPLATE_GENERATOR_PROMPT } from './prompts.js';
import { sanitizeStructuredValue } from './analysis-cleaner.js';
import { logError, logInfo, logWarn } from './observability.js';
import { fetchWithTimeout } from './api-utils.js';
import { stripOverlapPrefix } from './audio-utils.js';
import {
  OPENROUTER_BASE_URL, openRouterHeaders, openRouterJsonRequest, getOpenRouterCatalogue,
} from './openrouter.js';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

/**
 * Validates that a file path is within the allowed uploads directory.
 * Prevents path traversal attacks.
 */
function isSafeUploadPath(filePath) {
  if (!filePath) return false;
  const resolved = path.resolve(filePath);
  return resolved.startsWith(path.resolve(UPLOADS_DIR) + path.sep);
}

const TRANSCRIPTION_MODEL = null;
const ANALYSIS_MODEL = null;
const TRANSLATION_MODEL = null;
const TRANSCRIPTION_HTTP_TIMEOUT_MS = Number.parseInt(process.env.TRANSCRIPTION_HTTP_TIMEOUT_MS, 10) || 600_000;
const TRANSCRIBE_MAX_BYTES = Number.parseInt(process.env.TRANSCRIBE_MAX_BYTES, 10) || 24 * 1024 * 1024;
const TRANSCRIBE_CHUNK_SECONDS = Number.parseInt(process.env.TRANSCRIBE_CHUNK_SECONDS, 10) || 20 * 60;
const TRANSCRIBE_CHUNK_OVERLAP_SECONDS = Number.parseInt(process.env.TRANSCRIBE_CHUNK_OVERLAP_SECONDS, 10) || 5;
const COMPRESSED_BYTES_PER_SECOND = 8000; // 64 kbit/s mono MP3
const ANALYSIS_HTTP_TIMEOUT_MS = Number.parseInt(process.env.ANALYSIS_HTTP_TIMEOUT_MS, 10) || 180_000;

function configureFfmpegPath() {
  const ffmpegPath = String(process.env.FFMPEG_PATH || ffmpegInstaller.path || '/usr/bin/ffmpeg').trim();
  if (ffmpegPath) {
    try {
      ffmpeg.setFfmpegPath(ffmpegPath);
    } catch {
      // Let fluent-ffmpeg surface the real conversion error later.
    }
  }
}

async function estimateAudioDurationSeconds(filePath) {
  configureFfmpegPath();
  try {
    const metadata = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (error, data) => error ? reject(error) : resolve(data));
    });
    const duration = Number(metadata?.format?.duration || 0);
    if (duration > 0) return Math.ceil(duration);
  } catch {
    // The provider still reports actual duration; byte-rate fallback is only
    // used for the conservative pre-call reservation.
  }
  const { size } = await stat(filePath);
  return Math.max(1, Math.ceil(size / COMPRESSED_BYTES_PER_SECOND));
}

async function convertAudioToMp3(inputPath) {
  // SECURITY: Validate input path to prevent path traversal
  if (!isSafeUploadPath(inputPath)) {
    throw new Error('Invalid input path: Path traversal detected');
  }

  const outputPath = inputPath.replace(/\.[^.]+$/, '.mp3');

  // SECURITY: Also validate output path
  if (!isSafeUploadPath(outputPath)) {
    throw new Error('Invalid output path: Path traversal detected');
  }

  configureFfmpegPath();

  logInfo('audio.conversion_started', { inputPath });

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('mp3')
      .on('error', (err) => {
        logError('audio.conversion_failed', err, { inputPath });
        reject(err);
      })
      .on('end', () => {
        logInfo('audio.conversion_finished', { outputPath });
        resolve(outputPath);
      })
      .save(outputPath);
  });
}

async function compressAudioForTranscription(inputPath) {
  if (!isSafeUploadPath(inputPath)) {
    throw new Error('Invalid input path: Path traversal detected');
  }

  const outputPath = inputPath.replace(/\.[^.]+$/, '') + '.t16.mp3';
  if (!isSafeUploadPath(outputPath)) {
    throw new Error('Invalid output path: Path traversal detected');
  }

  configureFfmpegPath();
  logInfo('audio.compression_started', { inputPath });

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec('libmp3lame')
      .audioBitrate('64k')
      .toFormat('mp3')
      .on('error', (err) => {
        logError('audio.compression_failed', err, { inputPath });
        reject(err);
      })
      .on('end', () => {
        logInfo('audio.compression_finished', { outputPath });
        resolve(outputPath);
      })
      .save(outputPath);
  });
}

async function splitAudioIntoChunks(inputPath, chunkSeconds, overlapSeconds) {
  if (!isSafeUploadPath(inputPath)) {
    throw new Error('Invalid input path: Path traversal detected');
  }

  configureFfmpegPath();

  const { size } = await stat(inputPath);
  const durationSeconds = Math.max(1, size / COMPRESSED_BYTES_PER_SECOND);
  const step = Math.max(1, chunkSeconds - overlapSeconds);
  const base = inputPath.replace(/\.[^.]+$/, '');
  const chunkFiles = [];
  let index = 0;

  logInfo('audio.split_started', { inputPath, chunkSeconds, overlapSeconds });

  for (let start = 0; start < durationSeconds; start += step) {
    const outputPath = `${base}.part-${String(index).padStart(3, '0')}.mp3`;
    if (!isSafeUploadPath(outputPath)) {
      throw new Error('Invalid output path: Path traversal detected');
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .inputOptions(['-ss', String(start)])
        .outputOptions(['-t', String(chunkSeconds), '-c', 'copy'])
        .on('error', (err) => {
          logError('audio.split_failed', err, { inputPath, start });
          reject(err);
        })
        .on('end', () => resolve())
        .save(outputPath);
    });

    chunkFiles.push({ path: outputPath, offsetSeconds: start });
    index += 1;
    if (start + chunkSeconds >= durationSeconds) break;
  }

  logInfo('audio.split_finished', { chunks: chunkFiles.length });
  return chunkFiles;
}

// Exported so lib/edenai-service.js's transcribeAudioEdenAi can reuse the
// exact same ffmpeg-based chunking/compression logic — only the leaf
// per-chunk provider request differs between providers, not how a file
// gets split into TRANSCRIBE_CHUNK_SECONDS pieces.
export async function prepareAudioForTranscription(filePath) {
  const cleanupPaths = [];
  let fileToProcess = filePath;
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.webm' || ext === '.ogg') {
    fileToProcess = await convertAudioToMp3(filePath);
    cleanupPaths.push(fileToProcess);
  }

  const initialSize = (await stat(fileToProcess)).size;
  if (initialSize > TRANSCRIBE_MAX_BYTES) {
    const compressedPath = await compressAudioForTranscription(fileToProcess);
    cleanupPaths.push(compressedPath);
    fileToProcess = compressedPath;
  }

  const preparedSize = (await stat(fileToProcess)).size;
  if (preparedSize <= TRANSCRIBE_MAX_BYTES) {
    return {
      chunks: [{
        path: fileToProcess,
        offsetSeconds: 0,
        estimatedSeconds: await estimateAudioDurationSeconds(fileToProcess),
      }],
      cleanupPaths,
    };
  }

  const chunks = await splitAudioIntoChunks(
    fileToProcess,
    TRANSCRIBE_CHUNK_SECONDS,
    TRANSCRIBE_CHUNK_OVERLAP_SECONDS,
  );
  for (const chunk of chunks) {
    // eslint-disable-next-line no-await-in-loop
    chunk.estimatedSeconds = Math.min(
      TRANSCRIBE_CHUNK_SECONDS,
      await estimateAudioDurationSeconds(chunk.path),
    );
  }
  cleanupPaths.push(...chunks.map((chunk) => chunk.path));
  return { chunks, cleanupPaths };
}

function resolveAiBaseUrl() {
  return OPENROUTER_BASE_URL;
}

// OpenRouter does not expose a `supported_parameters` entry for STT
// vocabulary hints, and the option is honoured by only some upstream
// providers (currently Groq) behind the documented `provider.options`
// passthrough. Sending it is therefore best-effort: if OpenRouter routes
// the call elsewhere, the option is silently ignored rather than erroring.
const CONTEXT_BIAS_PROMPT_MAX_CHARS = 800;

function buildContextBiasProviderOptions(contextBias) {
  const terms = Array.isArray(contextBias) ? contextBias.filter(Boolean) : [];
  if (terms.length === 0) return null;
  const prompt = terms.join(', ').slice(0, CONTEXT_BIAS_PROMPT_MAX_CHARS);
  return { groq: { prompt } };
}

// Chat models only accept `temperature`/`response_format`/`stream` when the
// OpenRouter catalogue lists them under the model's `supported_parameters`;
// unsupported ones are stripped by openRouterJsonRequest. Resolve them here
// so callers don't each need direct catalogue access.
async function resolveSupportedParameters(model, apiKey, organizationId) {
  if (!apiKey || !model) return [];
  try {
    const { models } = await getOpenRouterCatalogue({ apiKey, organizationId, allowStale: true });
    return models.find((entry) => entry.id === model)?.supportedParameters || [];
  } catch {
    return [];
  }
}

function providerHttpError(message, status) {
  const error = new Error(message);
  error.status = Number(status);
  if (error.status >= 400 && error.status < 500 && error.status !== 408) {
    error.providerOutcome = 'non_billable';
  }
  return error;
}

async function requestTranscriptionFile(fileToProcess, {
  apiKey,
  transcriptionModel,
  language,
  contextBias = [],
  baseUrl,
  offsetSeconds = 0,
  verboseJsonSupported = false,
  fallbackModel = null,
  signal = null,
} = {}) {
  const audioBuffer = await readFile(fileToProcess);
  const currentExt = path.extname(fileToProcess).toLowerCase();
  const selectedModel = transcriptionModel || TRANSCRIPTION_MODEL;
  if (!selectedModel) throw Object.assign(new Error('MODEL_UNAVAILABLE'), { code: 'MODEL_UNAVAILABLE' });
  const inputFormat = currentExt.replace(/^\./, '') || 'mp3';
  const contextBiasOptions = buildContextBiasProviderOptions(contextBias);
  const payload = {
    input_audio: {
      data: audioBuffer.toString('base64'),
      format: inputFormat === 'weba' ? 'webm' : inputFormat,
    },
    model: selectedModel,
    language,
    provider: {
      zdr: true,
      data_collection: 'deny',
      ...(contextBiasOptions ? { options: contextBiasOptions } : {}),
    },
  };
  if (verboseJsonSupported) payload.response_format = 'verbose_json';

  const send = (selected) => fetchWithTimeout(`${resolveAiBaseUrl({ baseUrl })}/audio/transcriptions`, {
    method: 'POST',
    headers: openRouterHeaders(apiKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ...payload, model: selected }),
    signal,
  }, TRANSCRIPTION_HTTP_TIMEOUT_MS);

  let actualModel = selectedModel;
  let response = await send(actualModel);
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const detail = errorBody?.error?.message || errorBody?.message || response.statusText;
    const unavailable = response.status === 404 || /model.{0,40}(unavailable|not found|no endpoints)/i.test(detail);
    if (unavailable && fallbackModel && fallbackModel !== actualModel) {
      actualModel = fallbackModel;
      response = await send(actualModel);
    }
    if (!response.ok) {
      const retryBody = await response.json().catch(() => ({}));
      const retryDetail = retryBody?.error?.message || retryBody?.message || response.statusText;
      const providerError = providerHttpError(`OpenRouter transcription error: ${response.status} - ${retryDetail}`, response.status);
      if (response.status === 404 || /model.{0,40}(unavailable|not found|no endpoints)/i.test(retryDetail)) providerError.code = 'MODEL_UNAVAILABLE';
      throw providerError;
    }
  }

  const result = await response.json();
  const segments = Array.isArray(result.segments) && result.segments.length > 0 ? result.segments.map((segment) => {
    const shifted = { ...segment };
    if (typeof shifted.start === 'number') shifted.start += offsetSeconds;
    if (typeof shifted.end === 'number') shifted.end += offsetSeconds;
    shifted.precise_timestamps = true;
    return shifted;
  }) : [{ id: 0, start: null, end: null, text: result.text || '', precise_timestamps: false }];

  return {
    text: result.text || '',
    segments,
    usage: {
      ...(result.usage || {}),
      inputQuantity: Math.ceil(Number(result.usage?.seconds || result.usage?.audio_duration_seconds || 0))
        || Number(result.usage?.input_tokens || 0),
      outputQuantity: Number(result.usage?.output_tokens || 0),
    },
    model: result.model || actualModel,
    providerRequestId: response.headers.get('x-generation-id') || result.id || result.request_id || null,
    contextBiasForwarded: Boolean(contextBiasOptions),
  };
}

async function aiJsonRequest(endpoint, body, apiKey, timeoutMs = null, options = {}) {
  const supportedParameters = options.supportedParameters
    || await resolveSupportedParameters(body.model, apiKey, options.organizationId);
  const requestOptions = {
    timeoutMs: timeoutMs || undefined,
    signal: options.signal || null,
    supportedParameters,
  };
  try {
    const result = await openRouterJsonRequest(endpoint, body, apiKey, requestOptions);
    return { ...result, __selectedModel: body.model };
  } catch (error) {
    const fallback = options.fallbackModel;
    if (error?.code !== 'MODEL_UNAVAILABLE' || !fallback || fallback === body.model) throw error;
    const result = await openRouterJsonRequest(endpoint, { ...body, model: fallback }, apiKey, requestOptions);
    return { ...result, __selectedModel: fallback, __fellBack: true };
  }
}

/**
 * Transcribe audio through OpenRouter's /audio/transcriptions endpoint.
 * Returns { text, segments, usage, model }. The endpoint does not diarize;
 * speaker assignment happens manually in the UI (see buildTextWithSpeakers).
 */
export async function transcribeAudio(filePath, apiKey, options = {}) {
  const {
    contextBias = [],
    language = 'de',
    transcriptionModel = TRANSCRIPTION_MODEL,
    baseUrl = null,
    signal = null,
    executeChunk = null,
    beforeChunk = null,
    afterChunk = null,
    verboseJsonSupported = false,
    fallbackModel = null,
  } = options;
  const cleanupPaths = [];

  try {
    const prepared = await prepareAudioForTranscription(filePath);
    cleanupPaths.push(...prepared.cleanupPaths);

    const allSegments = [];
    let stitchedText = '';
    let totalUsage = {};
    let providerRequestId = null;
    let outputModel = transcriptionModel;
    let contextBiasForwarded = false;

    for (let chunkIndex = 0; chunkIndex < prepared.chunks.length; chunkIndex += 1) {
      const chunk = prepared.chunks[chunkIndex];
      if (signal?.aborted) throw signal.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' });
      // eslint-disable-next-line no-await-in-loop
      const chunkContext = beforeChunk
        ? await beforeChunk({ chunk, chunkIndex, chunkCount: prepared.chunks.length })
        : null;
      const executeRequest = ({ signal: requestSignal = signal } = {}) => requestTranscriptionFile(chunk.path, {
        apiKey,
        transcriptionModel,
        language,
        contextBias,
        baseUrl,
        offsetSeconds: chunk.offsetSeconds,
        verboseJsonSupported,
        fallbackModel,
        signal: requestSignal,
      });
      let result;
      try {
        // eslint-disable-next-line no-await-in-loop
        result = executeChunk
          ? await executeChunk({
            chunk,
            chunkIndex,
            chunkCount: prepared.chunks.length,
            signal,
            execute: executeRequest,
          })
          : await executeRequest();
      } catch (error) {
        // eslint-disable-next-line no-await-in-loop
        if (chunkContext?.onProviderError) await chunkContext.onProviderError(error);
        // Legacy callers may only supply release; never use it for an
        // uncertain timeout, abort, network failure, or 5xx outcome.
        if (chunkContext?.release && error?.providerOutcome === 'non_billable') {
          // eslint-disable-next-line no-await-in-loop
          await chunkContext.release(error);
        }
        throw error;
      }
      if (afterChunk) {
        // eslint-disable-next-line no-await-in-loop
        await afterChunk({ result, chunk, chunkIndex, chunkCount: prepared.chunks.length, chunkContext });
      }
      const chunkText = stitchedText
        ? stripOverlapPrefix(stitchedText, result.text)
        : result.text;
      stitchedText = [stitchedText, chunkText].filter(Boolean).join(stitchedText && chunkText ? '\n' : '');
      allSegments.push(...result.segments);
      totalUsage = {
        inputQuantity: (totalUsage.inputQuantity || 0) + (result.usage?.inputQuantity || 0),
        outputQuantity: (totalUsage.outputQuantity || 0) + (result.usage?.outputQuantity || 0),
        cost: (totalUsage.cost || 0) + (Number(result.usage?.cost) || 0),
      };
      providerRequestId = result.providerRequestId || providerRequestId;
      outputModel = result.model || outputModel;
      contextBiasForwarded = contextBiasForwarded || Boolean(result.contextBiasForwarded);
    }

    return {
      text: stitchedText,
      segments: allSegments,
      usage: totalUsage,
      model: outputModel,
      providerRequestId,
      contextBiasForwarded,
    };
  } catch (error) {
    if (String(error?.message || '').includes('Path traversal')) {
      throw error;
    }
    logError('audio.transcription_exception', error, { filePath });
    throw error;
  } finally {
    await Promise.all(cleanupPaths.map((cleanupPath) => unlink(cleanupPath).catch(() => {})));
  }
}

/**
 * Build the full transcription text with speaker names applied.
 * If speakers map is provided, replaces speaker_ids with real names.
 */
export function buildTextWithSpeakers(segments, speakerNames = {}) {
  if (!segments || segments.length === 0) return '';

  return segments.map((seg) => {
    const speakerId = seg.speaker_id || 'unknown';
    const name = speakerNames[speakerId] || speakerId;
    return `${name}: ${seg.text.trim()}`;
  }).join('\n\n');
}

/**
 * Analyze transcription text through OpenRouter Chat.
 * Accepts optional customPrompt for additional user context.
 */
export async function analyzeTranscription(text, template, apiKey, customPrompt = '', model = null, language = 'de', options = {}) {
  const prompt = getAnalysisPrompt(text, template, customPrompt, language);
  const usedModel = model || ANALYSIS_MODEL;
  if (!usedModel) throw Object.assign(new Error('MODEL_UNAVAILABLE'), { code: 'MODEL_UNAVAILABLE' });

  const systemContent = language === 'en'
    ? `You are an expert in analyzing transcriptions. Always respond in English and structure your output in JSON format.\n${OUTPUT_QUALITY_GUARD.en}`
    : `Du bist ein Experte für die Analyse von Transkriptionen. Antworte immer auf Deutsch und strukturiert im JSON-Format. Verwende in deutschen Textwerten echte Umlaute (ä, ö, ü, ß) und keine Umschreibungen wie ae, oe oder ue.\n${OUTPUT_QUALITY_GUARD.de}`;

  const result = await aiJsonRequest('/chat/completions', {
    model: usedModel,
    messages: [
      {
        role: 'system',
        content: systemContent,
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    response_format: { type: 'json_object' },
  }, apiKey, ANALYSIS_HTTP_TIMEOUT_MS, options);

  const content = result.choices[0]?.message?.content || '{}';

  let analysis;
  try {
    analysis = JSON.parse(content);
    // SECURITY: Validate parsed result is a plain object, not an array or other type
    if (analysis && typeof analysis === 'object' && !Array.isArray(analysis)) {
      analysis = sanitizeStructuredValue(analysis) || {};
    } else {
      // If result is not an object, wrap it
      analysis = { raw: content };
    }
  } catch {
    analysis = { raw: content };
  }

  return {
    analysis,
    usage: result.usage || {},
    model: result.__selectedModel || usedModel,
    providerRequestId: result.id || result.request_id || null,
  };
}

/**
 * Translate text through OpenRouter Chat.
 */
// Extra instruction added on a stricter retry when the model dropped a
// placeholder on the first attempt (see translation-glossary quality guard).
const STRICT_PLACEHOLDER_INSTRUCTION = 'CRITICAL: The text contains placeholder tokens such as DNTX0X…XTDN and TRMX0X…XMRT. Copy every placeholder into your output verbatim — identical characters, no inserted spaces, never translated, altered, or removed. A dropped placeholder makes the whole result unusable.';

export async function translateText(text, targetLanguage, sourceLanguage = 'auto', apiKey, model = null, options = {}) {
  const usedModel = model || TRANSLATION_MODEL;
  if (!usedModel) throw Object.assign(new Error('MODEL_UNAVAILABLE'), { code: 'MODEL_UNAVAILABLE' });
  const glossaryBlock = String(options?.glossaryBlock || '').trim();
  const strictBlock = options?.strictPlaceholders ? `\n\n${STRICT_PLACEHOLDER_INSTRUCTION}` : '';

  const systemPrompt = `You are a professional translator. Translate the provided text into ${targetLanguage}.
${sourceLanguage !== 'auto' ? `The source language is ${sourceLanguage}.` : 'Detect the source language automatically.'}
Maintain the original tone and nuances.

IMPORTANT: The input may contain HTML tags or Markdown formatting.
1. Keep all structural elements (paragraphs, headers, lists, tables) exactly as they are.
2. If the input is HTML, return valid HTML. If it is Markdown, return valid Markdown.
3. Only return the translated content without any explanations or preamble.${glossaryBlock ? `\n\n${glossaryBlock}` : ''}${strictBlock}`;

  const result = await aiJsonRequest('/chat/completions', {
    model: usedModel,
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: text,
      },
    ],
    temperature: 0.3,
  }, apiKey, null, options);

  return {
    translatedText: result.choices[0]?.message?.content || '',
    usage: result.usage || {},
    model: result.__selectedModel || usedModel,
    providerRequestId: result.id || result.request_id || null,
  };
}

export async function translateTextSegments(segments, targetLanguage, sourceLanguage = 'auto', apiKey, model = null, options = {}) {
  const usedModel = model || TRANSLATION_MODEL;
  if (!usedModel) throw Object.assign(new Error('MODEL_UNAVAILABLE'), { code: 'MODEL_UNAVAILABLE' });
  const glossaryBlock = String(options?.glossaryBlock || '').trim();
  const safeSegments = Array.isArray(segments) ? segments.map((entry) => String(entry ?? '')) : [];
  if (safeSegments.length === 0) {
    return { translations: [], usage: {}, model: usedModel };
  }

  const strictBlock = options?.strictPlaceholders ? `\n\n${STRICT_PLACEHOLDER_INSTRUCTION}` : '';
  const systemPrompt = `You are a professional translator for office documents.
Translate every segment into ${targetLanguage}.
${sourceLanguage !== 'auto' ? `The source language is ${sourceLanguage}.` : 'Detect the source language automatically.'}
Return strict JSON with exactly this shape: {"translations":["..."]}.
Rules:
- The translations array must have exactly the same length and order as the input segments.
- Translate only the text content.
- Do not add explanations, numbering, markdown, XML, or extra fields.
- Preserve short placeholders, product names, numbers, and punctuation when appropriate.${glossaryBlock ? `\n\n${glossaryBlock}` : ''}${strictBlock}`;

  const result = await aiJsonRequest('/chat/completions', {
    model: usedModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify({ segments: safeSegments }) },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  }, apiKey, ANALYSIS_HTTP_TIMEOUT_MS, options);

  const content = result.choices[0]?.message?.content || '{}';
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = null;
  }

  const translations = Array.isArray(parsed?.translations)
    ? parsed.translations.map((entry) => String(entry ?? ''))
    : null;

  if (!translations || translations.length !== safeSegments.length) {
    const error = new Error('SEGMENT_TRANSLATION_SHAPE_MISMATCH');
    error.providerUsage = result.usage || {};
    error.providerModel = result.__selectedModel || usedModel;
    error.providerRequestId = result.id || result.request_id || null;
    throw error;
  }

  return {
    translations,
    usage: result.usage || {},
    model: result.__selectedModel || usedModel,
    providerRequestId: result.id || result.request_id || null,
  };
}

export async function optimizeText(text, preset, customInstruction = '', apiKey, model = null, options = {}) {
  const usedModel = model || TRANSLATION_MODEL;
  if (!usedModel) throw Object.assign(new Error('MODEL_UNAVAILABLE'), { code: 'MODEL_UNAVAILABLE' });
  const presetInstructions = {
    // Every sentence beyond "preserve meaning and structure" here was
    // added in response to a specific, real failure observed live
    // against EdenAI chat models across 5 German/English test texts,
    // several with repeated reruns for stability (2026-08-28, see
    // hardcode-edenai-models/design.md's revision history):
    //   1. Smaller/cheaper models substitute correctly-used words with
    //      synonyms (German "also"→"Auch", "sagen"→"mitteilen",
    //      "heisst"→"bedeutet") — real meaning changes, not corrections.
    //      → "Do not rephrase... substitute words with synonyms."
    //   2. They also expand legitimate informal contractions into fuller,
    //      more formal forms (German "hab"→"habe") — a register change,
    //      not an error fix.
    //      → "Do not expand an informal contraction..."
    //   3. Over-correcting (1) and (2) too aggressively made an earlier
    //      draft of this instruction stop capitalizing filler/informal
    //      words at the start of a sentence too (treating capitalization
    //      itself as a forbidden "change") — confirmed reproducible
    //      (identical wrong output across 3 reruns), not a fluke.
    //      → the explicit "This does not exempt them from normal
    //      capitalization and spelling rules" clause.
    // All three additions were verified together, in both German and
    // English, with no under-correction regression on any of 5 test
    // texts across 3+ reruns each. Kept identical to
    // lib/edenai-service.js's optimizeTextEdenAi on purpose — the two
    // are meant to stay in sync.
    spelling_grammar: 'Correct spelling, grammar, punctuation and obvious typos. Preserve meaning and structure. Do not rephrase, reword, or substitute words with synonyms. Do not expand an informal contraction or shortened word form into its fuller, more formal equivalent — keep colloquial, informal, and filler words exactly as chosen by the writer. This does not exempt them from normal capitalization and spelling rules: still capitalize a filler word at the start of a sentence and fix a genuine misspelling, exactly as you would for any other word.',
    friendlier: 'Rewrite the text in a friendlier tone while preserving the factual content.',
    more_formal: 'Rewrite the text in a more formal and professional tone while preserving the factual content.',
    shorter: 'Make the text shorter and more concise without losing important information.',
    clearer: 'Rewrite the text to be clearer, better structured and easier to understand.',
    email_improve: 'Improve the text as a professional email. Preserve intent, make it clear, polite and actionable.',
  };
  const instruction = presetInstructions[preset] || presetInstructions.clearer;

  const systemPrompt = `You are a precise business text editor.
Task: ${instruction}
${customInstruction ? `Additional user instruction: ${customInstruction}` : ''}
Return only the improved text. Do not add explanations or commentary.`;

  const result = await aiJsonRequest('/chat/completions', {
    model: usedModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: String(text || '') },
    ],
    temperature: 0.25,
  }, apiKey, ANALYSIS_HTTP_TIMEOUT_MS, options);

  return {
    optimizedText: result.choices[0]?.message?.content || '',
    usage: result.usage || {},
    model: result.__selectedModel || usedModel,
    providerRequestId: result.id || result.request_id || null,
  };
}

export async function performOCR(filePath, apiKey, mimeType = 'application/pdf', options = {}) {
  const model = options.model;
  if (!model) throw Object.assign(new Error('MODEL_UNAVAILABLE'), { code: 'MODEL_UNAVAILABLE' });
  const bytes = await readFile(filePath);
  const dataUrl = `data:${mimeType};base64,${bytes.toString('base64')}`;
  const prompt = 'Extract every visible word from this document. Preserve headings, paragraphs, lists and tables. Return only faithful Markdown without commentary.';
  const content = mimeType === 'application/pdf'
    ? [{ type: 'text', text: prompt }, { type: 'file', file: { filename: path.basename(filePath), file_data: dataUrl } }]
    : [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }];
  const body = {
    model,
    messages: [{ role: 'user', content }],
    temperature: 0,
  };
  if (mimeType === 'application/pdf') {
    body.plugins = [{ id: 'file-parser', pdf: { engine: 'mistral-ocr' } }];
  }
  const result = await aiJsonRequest('/chat/completions', body, apiKey, ANALYSIS_HTTP_TIMEOUT_MS, options);
  return {
    markdown: result.choices?.[0]?.message?.content || '',
    usage: result.usage || {},
    model: result.__selectedModel || model,
    providerRequestId: result.id || result.request_id || null,
  };
}

// Exported (was private) so lib/edenai-service.js's
// analyzeTranscriptionEdenAi can build the exact same prompt — this is a
// data-driven template/prompt builder, not a static string, so it's
// imported rather than duplicated (unlike e.g. STRICT_PLACEHOLDER_INSTRUCTION)
// to avoid the two providers' analysis prompts silently drifting apart.
export function getAnalysisPrompt(text, template, customPrompt = '', language = 'de') {
  const templateName = typeof template === 'string'
    ? template
    : typeof template?.name === 'string'
      ? template.name
      : '';
  const templatePromptText = typeof template === 'string'
    ? template
    : typeof template?.prompt_text === 'string'
      ? template.prompt_text
      : '';

  let basePrompt;

  if (
    templateName === 'meeting'
    || templateName === 'generic'
    || templateName === 'action_items'
    || templateName === 'fat_sat'
    || templateName === 'engineering_review'
    || templateName === 'data_table'
    // Legacy: `aufmass` is no longer offered in the UI, but old DB rows
    // still reference it and must continue to analyse.
    || templateName === 'aufmass'
  ) {
    basePrompt = `${getPrompt(templateName, language)}\n\n${language === 'en' ? 'Transcript' : 'Transkript'}:\n${text}`;
  } else if (templatePromptText && templatePromptText.trim()) {
    // Treat as custom template / custom prompt text.
    const transcriptLabel = language === 'en' ? 'Transcript' : 'Transkript';
    basePrompt = templatePromptText.includes('{{TEXT}}')
      ? templatePromptText.replaceAll('{{TEXT}}', text)
      : `${templatePromptText}\n\n${transcriptLabel}:\n${text}`;
  } else {
    // Defensive fallback for inconsistent template payloads.
    basePrompt = `${getPrompt('generic', language)}\n\n${language === 'en' ? 'Transcript' : 'Transkript'}:\n${text}`;
  }

  if (customPrompt) {
    const label = language === 'en' ? 'Additional context from user' : 'Zusätzlicher Kontext vom Benutzer';
    const priorityHint = language === 'en'
      ? 'Priority rule: The following additional context is binding and overrides generic defaults if conflicts occur.'
      : 'Prioritätsregel: Der folgende Zusatzkontext ist verbindlich und überschreibt bei Konflikten allgemeine Standardregeln.';
    basePrompt += `\n\n${priorityHint}\n${label}:\n${customPrompt}`;
  }

  basePrompt += `\n\n${language === 'en' ? OUTPUT_QUALITY_GUARD.en : OUTPUT_QUALITY_GUARD.de}`;

  return basePrompt;
}

/**
 * Generate a new template prompt based on a user's goal.
 */
export async function generateTemplate(goal, apiKey, model = null, options = {}) {
  const prompt = TEMPLATE_GENERATOR_PROMPT.replace('{{USER_GOAL}}', goal);
  const usedModel = model || ANALYSIS_MODEL;
  if (!usedModel) throw Object.assign(new Error('MODEL_UNAVAILABLE'), { code: 'MODEL_UNAVAILABLE' });

  const result = await aiJsonRequest('/chat/completions', {
    model: usedModel,
    messages: [
      {
        role: 'system',
        content: 'You are a professional prompt engineer. You output only the final system prompt text, nothing else.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.7,
  }, apiKey, null, options);

  return {
    promptText: result.choices[0]?.message?.content?.trim() || '',
    usage: result.usage || {},
    model: result.__selectedModel || usedModel,
    providerRequestId: result.id || result.request_id || null,
  };
}
