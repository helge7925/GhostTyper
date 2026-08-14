import { readFile, stat, unlink } from 'fs/promises';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { DEFAULT_PROMPTS, getPrompt, OUTPUT_QUALITY_GUARD, TEMPLATE_GENERATOR_PROMPT } from './prompts';
import { sanitizeStructuredValue } from './analysis-cleaner';
import { logError, logInfo, logWarn } from './observability';
import { fetchWithTimeout } from './api-utils';
import { stripOverlapPrefix } from './audio-utils';
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_CORTECS_BASE_URL,
  DEFAULT_TRANSCRIPTION_MODEL,
} from './constants';

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

const MISTRAL_API_URL = 'https://api.mistral.ai/v1';
const CORTECS_API_URL = (process.env.CORTECS_BASE_URL || DEFAULT_CORTECS_BASE_URL).replace(/\/+$/, '');
const TRANSCRIPTION_MODEL = DEFAULT_TRANSCRIPTION_MODEL;
const ANALYSIS_MODEL = DEFAULT_CHAT_MODEL;
const TRANSLATION_MODEL = DEFAULT_CHAT_MODEL;
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

async function prepareAudioForTranscription(filePath) {
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

function resolveCortecsBaseUrl(options = {}) {
  return String(options.baseUrl || CORTECS_API_URL || DEFAULT_CORTECS_BASE_URL).replace(/\/+$/, '');
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
  preference,
  contextBias = [],
  baseUrl,
  offsetSeconds = 0,
  signal = null,
} = {}) {
  const audioBuffer = await readFile(fileToProcess);
  const currentExt = path.extname(fileToProcess).toLowerCase();

  const mimeTypes = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
    '.aac': 'audio/aac',
    '.webm': 'audio/webm',
    '.weba': 'audio/webm',
  };
  const mimeType = mimeTypes[currentExt] || 'audio/mpeg';
  const filename = path.basename(fileToProcess);

  const formData = new FormData();
  const fileBlob = new Blob([audioBuffer], { type: mimeType });
  formData.append('file', fileBlob, filename);
  formData.append('model', transcriptionModel || TRANSCRIPTION_MODEL);
  formData.append('language', language);
  formData.append('response_format', 'verbose_json');
  formData.append('preference', preference || 'balanced');

  if (contextBias.length > 0) {
    formData.append('prompt', contextBias.join(', '));
  }

  const response = await fetchWithTimeout(`${resolveCortecsBaseUrl({ baseUrl })}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
    signal,
  }, TRANSCRIPTION_HTTP_TIMEOUT_MS);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const detail = error?.error?.message || error?.message || response.statusText;
    throw providerHttpError(`Cortecs transcription error: ${response.status} - ${detail}`, response.status);
  }

  const result = await response.json();
  const segments = Array.isArray(result.segments) ? result.segments.map((segment) => {
    const shifted = { ...segment };
    if (typeof shifted.start === 'number') shifted.start += offsetSeconds;
    if (typeof shifted.end === 'number') shifted.end += offsetSeconds;
    return shifted;
  }) : [];

  return {
    text: result.text || '',
    segments,
    usage: Number(result.usage?.audio_duration_seconds || 0) > 0
      ? { input_tokens: Math.ceil(Number(result.usage.audio_duration_seconds || 0)), output_tokens: 0 }
      : (result.usage || {}),
    model: result.model || transcriptionModel || TRANSCRIPTION_MODEL,
    providerRequestId: result.id || result.request_id || null,
  };
}

async function cortecsJsonRequest(endpoint, body, apiKey, timeoutMs = null, options = {}) {
  const response = await fetchWithTimeout(`${resolveCortecsBaseUrl(options)}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  }, timeoutMs);

  if (!response.ok) {
    const errorText = await response.text();
    logWarn('cortecs.api_error', { endpoint, status: response.status });
    let errorMessage = response.statusText;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson?.error?.message || errorJson.message || errorMessage;
    } catch (e) {}
    throw providerHttpError(`Cortecs API error: ${response.status} - ${errorMessage}`, response.status);
  }

  return response.json();
}

async function mistralJsonRequest(endpoint, body, apiKey, timeoutMs = null, options = {}) {
  const response = await fetchWithTimeout(`${MISTRAL_API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  }, timeoutMs);

  if (!response.ok) {
    const errorText = await response.text();
    logWarn('mistral.api_error', { endpoint, status: response.status });
    let errorMessage = response.statusText;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.message || errorMessage;
    } catch (e) {}
    throw providerHttpError(`Mistral API error: ${response.status} - ${errorMessage}`, response.status);
  }

  return response.json();
}

/**
 * Transcribe audio using Cortecs' OpenAI-compatible /audio/transcriptions.
 * Returns { text, segments, usage, model }. The endpoint does not diarize;
 * speaker assignment happens manually in the UI (see buildTextWithSpeakers).
 */
export async function transcribeAudio(filePath, apiKey, options = {}) {
  const {
    contextBias = [],
    language = 'de',
    transcriptionModel = TRANSCRIPTION_MODEL,
    baseUrl = null,
    preference = 'balanced',
    signal = null,
    executeChunk = null,
    beforeChunk = null,
    afterChunk = null,
  } = options;
  const cleanupPaths = [];

  try {
    const prepared = await prepareAudioForTranscription(filePath);
    cleanupPaths.push(...prepared.cleanupPaths);

    const allSegments = [];
    let stitchedText = '';
    let totalUsage = {};

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
        preference,
        contextBias,
        baseUrl,
        offsetSeconds: chunk.offsetSeconds,
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
        input_tokens: (totalUsage.input_tokens || 0) + (result.usage?.input_tokens || 0),
        output_tokens: (totalUsage.output_tokens || 0) + (result.usage?.output_tokens || 0),
      };
    }

    return {
      text: stitchedText,
      segments: allSegments,
      usage: totalUsage,
      model: transcriptionModel,
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
 * Analyze transcription text using Cortecs Chat.
 * Accepts optional customPrompt for additional user context.
 */
export async function analyzeTranscription(text, template, apiKey, customPrompt = '', model = null, language = 'de', options = {}) {
  const prompt = getAnalysisPrompt(text, template, customPrompt, language);
  const usedModel = model || ANALYSIS_MODEL;

  const systemContent = language === 'en'
    ? `You are an expert in analyzing transcriptions. Always respond in English and structure your output in JSON format.\n${OUTPUT_QUALITY_GUARD.en}`
    : `Du bist ein Experte für die Analyse von Transkriptionen. Antworte immer auf Deutsch und strukturiert im JSON-Format. Verwende in deutschen Textwerten echte Umlaute (ä, ö, ü, ß) und keine Umschreibungen wie ae, oe oder ue.\n${OUTPUT_QUALITY_GUARD.de}`;

  const result = await cortecsJsonRequest('/chat/completions', {
    model: usedModel,
    preference: options.preference || 'balanced',
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
    model: usedModel,
    providerRequestId: result.id || result.request_id || null,
  };
}

/**
 * Translate text using Cortecs Chat.
 */
// Extra instruction added on a stricter retry when the model dropped a
// placeholder on the first attempt (see translation-glossary quality guard).
const STRICT_PLACEHOLDER_INSTRUCTION = 'CRITICAL: The text contains placeholder tokens such as DNTX0X…XTDN and TRMX0X…XMRT. Copy every placeholder into your output verbatim — identical characters, no inserted spaces, never translated, altered, or removed. A dropped placeholder makes the whole result unusable.';

export async function translateText(text, targetLanguage, sourceLanguage = 'auto', apiKey, model = null, options = {}) {
  const usedModel = model || TRANSLATION_MODEL;
  const glossaryBlock = String(options?.glossaryBlock || '').trim();
  const strictBlock = options?.strictPlaceholders ? `\n\n${STRICT_PLACEHOLDER_INSTRUCTION}` : '';

  const systemPrompt = `You are a professional translator. Translate the provided text into ${targetLanguage}.
${sourceLanguage !== 'auto' ? `The source language is ${sourceLanguage}.` : 'Detect the source language automatically.'}
Maintain the original tone and nuances.

IMPORTANT: The input may contain HTML tags or Markdown formatting.
1. Keep all structural elements (paragraphs, headers, lists, tables) exactly as they are.
2. If the input is HTML, return valid HTML. If it is Markdown, return valid Markdown.
3. Only return the translated content without any explanations or preamble.${glossaryBlock ? `\n\n${glossaryBlock}` : ''}${strictBlock}`;

  const result = await cortecsJsonRequest('/chat/completions', {
    model: usedModel,
    preference: options.preference || 'balanced',
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
    model: usedModel,
    providerRequestId: result.id || result.request_id || null,
  };
}

export async function translateTextSegments(segments, targetLanguage, sourceLanguage = 'auto', apiKey, model = null, options = {}) {
  const usedModel = model || TRANSLATION_MODEL;
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

  const result = await cortecsJsonRequest('/chat/completions', {
    model: usedModel,
    preference: options.preference || 'balanced',
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
    error.providerModel = usedModel;
    error.providerRequestId = result.id || result.request_id || null;
    throw error;
  }

  return {
    translations,
    usage: result.usage || {},
    model: usedModel,
    providerRequestId: result.id || result.request_id || null,
  };
}

export async function optimizeText(text, preset, customInstruction = '', apiKey, model = null, options = {}) {
  const usedModel = model || TRANSLATION_MODEL;
  const presetInstructions = {
    spelling_grammar: 'Correct spelling, grammar, punctuation and obvious typos. Preserve meaning and structure.',
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

  const result = await cortecsJsonRequest('/chat/completions', {
    model: usedModel,
    preference: options.preference || 'balanced',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: String(text || '') },
    ],
    temperature: 0.25,
  }, apiKey, ANALYSIS_HTTP_TIMEOUT_MS, options);

  return {
    optimizedText: result.choices[0]?.message?.content || '',
    usage: result.usage || {},
    model: usedModel,
    providerRequestId: result.id || result.request_id || null,
  };
}

/**
 * Upload a file to Mistral Files API.
 */
async function uploadFileToMistral(filePath, apiKey, mimeType = 'application/octet-stream', options = {}) {
  const fileBuffer = await readFile(filePath);
  const filename = path.basename(filePath);
  const blob = new Blob([fileBuffer], { type: mimeType });
  
  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('purpose', 'ocr');

  const response = await fetchWithTimeout(`${MISTRAL_API_URL}/files`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
    signal: options.signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw providerHttpError(
      `Mistral file upload error: ${response.status} - ${error.message || response.statusText}`,
      response.status,
    );
  }

  return response.json();
}

/**
 * Delete a file from Mistral Files API.
 */
async function deleteFileFromMistral(fileId, apiKey, options = {}) {
  const response = await fetchWithTimeout(`${MISTRAL_API_URL}/files/${fileId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    signal: options.signal,
  });

  if (!response.ok) {
    logWarn('mistral.file_delete_failed', { fileId, status: response.status });
  }
}

/**
 * Perform OCR on a file using Mistral OCR.
 */
export async function performOCR(filePath, apiKey, mimeType = 'application/pdf', options = {}) {
  const OCR_MODEL = 'mistral-ocr-latest';
  let fileId = null;

  try {
    // 1. Upload file
    const uploadResult = await uploadFileToMistral(filePath, apiKey, mimeType, options);
    fileId = uploadResult.id;

    // 2. Small delay to ensure file is ready in Mistral's storage
    await new Promise(resolve => setTimeout(resolve, 1500));

    // 3. Get signed URL for the file
    const signedUrlResult = await fetchWithTimeout(`${MISTRAL_API_URL}/files/${fileId}/url`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: options.signal,
    });
    
    if (!signedUrlResult.ok) {
      throw providerHttpError(
        `Failed to get signed URL for OCR: ${signedUrlResult.status}`,
        signedUrlResult.status,
      );
    }
    
    const { url: signedUrl } = await signedUrlResult.json();

    // 4. Process OCR
    const ocrResult = await mistralJsonRequest('/ocr', {
      model: OCR_MODEL,
      document: {
        type: 'document_url',
        document_url: signedUrl,
      },
    }, apiKey, null, options);

    // 5. Combine Markdown from all pages
    const markdown = ocrResult.pages?.map(p => p.markdown).join('\n\n') || '';

    return {
      markdown,
      usage: ocrResult.usage || {},
      model: OCR_MODEL,
      providerRequestId: ocrResult.id || ocrResult.request_id || null,
    };
  } finally {
    // 6. Cleanup
    if (fileId) {
      await deleteFileFromMistral(fileId, apiKey).catch((error) => {
        logWarn('mistral.file_delete_failed', { fileId, error: error?.message || String(error) });
      });
    }
  }
}

function getAnalysisPrompt(text, template, customPrompt = '', language = 'de') {
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

  const result = await cortecsJsonRequest('/chat/completions', {
    model: usedModel,
    preference: options.preference || 'balanced',
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
    model: usedModel,
    providerRequestId: result.id || result.request_id || null,
  };
}
