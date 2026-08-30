// Grows one export per EdenAI workload-migration change, mirroring
// lib/ai-service.js's OpenRouter-facing exports one capability at a
// time: translateTextEdenAi/translateTextSegmentsEdenAi
// (migrate-translation-to-edenai), transcribeAudioEdenAi
// (migrate-batch-transcription-to-edenai), performOcrEdenAi
// (migrate-ocr-extraction-to-edenai), synthesizeSpeechEdenAi
// (migrate-tts-to-edenai — pulled out of the originally-planned
// migrate-chat-tts-and-decommission-openrouter bundle, same reasoning as
// gladia/deepgram etc.: each capability gets its own real comparison
// test and its own change once decided, chat/analysis are not part of
// this). Each function returns exactly the shape its lib/ai-service.js
// (or lib/tts.js) counterpart returns, so call sites only change which
// function they import, not how they use the result.

import { readFile, unlink } from 'fs/promises';
import path from 'path';
import {
  edenAiJsonRequest, EdenAiError, uploadEdenAiFile, submitEdenAiAsyncJob, pollEdenAiAsyncJob,
  EDENAI_TTS_DEFAULT_VOICE,
} from './edenai.js';
import { prepareAudioForTranscription, getAnalysisPrompt } from './ai-service.js';
import { stripOverlapPrefix } from './audio-utils.js';
import { rasterizePdfToImages } from './pdf-rasterize.js';
import { safeFetch } from './network-guard.js';
import { mp3ToCanonicalPcm } from './tts.js';
import { OUTPUT_QUALITY_GUARD, TEMPLATE_GENERATOR_PROMPT } from './prompts.js';
import { sanitizeStructuredValue } from './analysis-cleaner.js';

// Extra instruction added on a stricter retry when the model dropped a
// placeholder on the first attempt — kept byte-for-byte identical to
// lib/ai-service.js's STRICT_PLACEHOLDER_INSTRUCTION so the glossary
// guard (lib/translation-glossary.js) behaves identically regardless of
// provider.
const STRICT_PLACEHOLDER_INSTRUCTION = 'CRITICAL: The text contains placeholder tokens such as DNTX0X…XTDN and TRMX0X…XMRT. Copy every placeholder into your output verbatim — identical characters, no inserted spaces, never translated, altered, or removed. A dropped placeholder makes the whole result unusable.';

// Mirrors lib/ai-service.js's translateText exactly (same prompt shape,
// same return contract) — only the transport differs (EdenAI's
// /chat/completions instead of OpenRouter's). Used by
// pages/api/translate.js once a workspace has activated EdenAI for the
// `chat` capability. There is no EdenAI-native translation adapter: see
// lib/edenai.js's EDENAI_HARDCODED_MODEL comment for why the dedicated
// translation/automatic_translation feature was live-tested and rejected
// in favor of routing translation through chat, exactly like
// spelling_grammar.
export async function translateTextEdenAi(text, targetLanguage, sourceLanguage = 'auto', apiKey, model, options = {}) {
  if (!model) throw Object.assign(new Error('MODEL_UNAVAILABLE'), { code: 'MODEL_UNAVAILABLE' });
  const glossaryBlock = String(options?.glossaryBlock || '').trim();
  const strictBlock = options?.strictPlaceholders ? `\n\n${STRICT_PLACEHOLDER_INSTRUCTION}` : '';

  const systemPrompt = `You are a professional translator. Translate the provided text into ${targetLanguage}.
${sourceLanguage !== 'auto' ? `The source language is ${sourceLanguage}.` : 'Detect the source language automatically.'}
Maintain the original tone and nuances.

IMPORTANT: The input may contain HTML tags or Markdown formatting.
1. Keep all structural elements (paragraphs, headers, lists, tables) exactly as they are.
2. If the input is HTML, return valid HTML. If it is Markdown, return valid Markdown.
3. Only return the translated content without any explanations or preamble.${glossaryBlock ? `\n\n${glossaryBlock}` : ''}${strictBlock}`;

  const result = await edenAiJsonRequest('/chat/completions', {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ],
    temperature: 0.3,
  }, apiKey, options);

  return {
    translatedText: result.choices?.[0]?.message?.content || '',
    usage: result.usage || {},
    model: result.model || model,
    providerRequestId: result.id || null,
  };
}

// Mirrors lib/ai-service.js's translateTextSegments exactly (same
// strict-JSON-array contract, same return shape) — verified live against
// mistral-small-latest across multiple segment batches including an
// empty segment and a placeholder-only segment, stable across 3 reruns
// (see migrate-translation-to-edenai/design.md).
export async function translateTextSegmentsEdenAi(segments, targetLanguage, sourceLanguage = 'auto', apiKey, model, options = {}) {
  if (!model) throw Object.assign(new Error('MODEL_UNAVAILABLE'), { code: 'MODEL_UNAVAILABLE' });
  const glossaryBlock = String(options?.glossaryBlock || '').trim();
  const safeSegments = Array.isArray(segments) ? segments.map((entry) => String(entry ?? '')) : [];
  if (safeSegments.length === 0) {
    return { translations: [], usage: {}, model };
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

  const result = await edenAiJsonRequest('/chat/completions', {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify({ segments: safeSegments }) },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  }, apiKey, options);

  const content = result.choices?.[0]?.message?.content || '{}';
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
    error.providerModel = result.model || model;
    error.providerRequestId = result.id || null;
    throw error;
  }

  return {
    translations,
    usage: result.usage || {},
    model: result.model || model,
    providerRequestId: result.id || null,
  };
}

const EDENAI_STT_POLL_INTERVAL_MS = Number.parseInt(process.env.EDENAI_STT_POLL_INTERVAL_MS, 10) || 3000;
// Batch STT jobs run against up-to-20-minute chunks (TRANSCRIBE_CHUNK_SECONDS
// in lib/ai-service.js) — 10 minutes of poll budget per chunk is generous
// slack over the sub-minute turnaround seen in live testing, not a
// measured worst case (unlike the live-meeting-STT phase's planned
// p95 latency gate, which is a real-time path this one is not).
const EDENAI_STT_POLL_TIMEOUT_MS = Number.parseInt(process.env.EDENAI_STT_POLL_TIMEOUT_MS, 10) || 600_000;

// One chunk's upload → submit → poll-to-completion round trip. EdenAI's
// speech_to_text_async input schema (GET /v3/info/audio/
// speech_to_text_async) has no instruction/prompt/glossary channel —
// unlike chat, there is nothing here to forward context-bias terms
// into, so that stays best-effort-unsupported for EdenAI exactly as
// documented at this call's only caller.
async function transcribeChunkEdenAi(chunkPath, apiKey, model, language, signal) {
  const buffer = await readFile(chunkPath);
  const fileId = await uploadEdenAiFile(buffer, path.basename(chunkPath), apiKey, { signal });
  let jobResult = await submitEdenAiAsyncJob({
    model,
    input: { file: fileId, language, speakers: 1 },
  }, apiKey, { signal });

  if (jobResult.status !== 'success' && jobResult.status !== 'failed') {
    if (!jobResult.jobId) {
      throw new EdenAiError('EdenAI transcription job returned no job id to poll.', {
        status: 502,
        code: 'EDENAI_REQUEST_FAILED',
      });
    }
    const deadline = Date.now() + EDENAI_STT_POLL_TIMEOUT_MS;
    while (jobResult.status !== 'success' && jobResult.status !== 'failed') {
      if (signal?.aborted) throw signal.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' });
      if (Date.now() > deadline) {
        throw new EdenAiError('EdenAI transcription job timed out.', {
          status: 504,
          code: 'EDENAI_REQUEST_FAILED',
          details: { jobId: jobResult.jobId },
        });
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, EDENAI_STT_POLL_INTERVAL_MS); });
      // eslint-disable-next-line no-await-in-loop
      jobResult = await pollEdenAiAsyncJob(jobResult.jobId, apiKey, { signal });
    }
  }

  if (jobResult.status === 'failed') {
    const detail = jobResult.error?.message || jobResult.error || 'unknown error';
    throw new EdenAiError(`EdenAI transcription job failed: ${detail}.`, {
      status: 502,
      code: 'EDENAI_REQUEST_FAILED',
      details: { jobId: jobResult.jobId },
    });
  }

  return { text: jobResult.output?.text || '', jobId: jobResult.jobId };
}

// Wraps EdenAI's async speech-to-text job (upload → submit → poll)
// behind the same per-chunk synchronous contract
// lib/ai-service.js's transcribeAudio already exposes to its callers
// (transcription-worker.js) — same options shape
// (signal/executeChunk/beforeChunk/afterChunk), same return contract
// (text/segments/usage/model/providerRequestId/contextBiasForwarded),
// and reuses that file's exact chunking/compression/overlap-stitching
// logic (prepareAudioForTranscription, stripOverlapPrefix) rather than
// duplicating it — only the leaf per-chunk request differs. EdenAI's
// speech_to_text_async output has no per-segment timestamps in this
// schema (only full text + diarization, and adopting diarization is
// explicitly out of scope for this migration — see
// migrate-batch-transcription-to-edenai/design.md), so each chunk
// contributes one untimestamped pseudo-segment, exactly mirroring
// requestTranscriptionFile's own fallback when OpenRouter's
// verbose_json/segments aren't available.
export async function transcribeAudioEdenAi(filePath, apiKey, model, options = {}) {
  if (!model) throw Object.assign(new Error('MODEL_UNAVAILABLE'), { code: 'MODEL_UNAVAILABLE' });
  const {
    language = 'de',
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
    let providerRequestId = null;

    for (let chunkIndex = 0; chunkIndex < prepared.chunks.length; chunkIndex += 1) {
      const chunk = prepared.chunks[chunkIndex];
      if (signal?.aborted) throw signal.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' });
      // eslint-disable-next-line no-await-in-loop
      const chunkContext = beforeChunk
        ? await beforeChunk({ chunk, chunkIndex, chunkCount: prepared.chunks.length })
        : null;
      const executeRequest = async ({ signal: requestSignal = signal } = {}) => {
        const chunkResult = await transcribeChunkEdenAi(chunk.path, apiKey, model, language, requestSignal);
        return {
          text: chunkResult.text,
          segments: [{
            id: 0, start: null, end: null, text: chunkResult.text, precise_timestamps: false,
          }],
          usage: { inputQuantity: Math.ceil(chunk.estimatedSeconds || 0), outputQuantity: 0 },
          model,
          providerRequestId: chunkResult.jobId || null,
          contextBiasForwarded: false,
        };
      };
      let result;
      try {
        // eslint-disable-next-line no-await-in-loop
        result = executeChunk
          ? await executeChunk({
            chunk, chunkIndex, chunkCount: prepared.chunks.length, signal, execute: executeRequest,
          })
          : await executeRequest();
      } catch (error) {
        // eslint-disable-next-line no-await-in-loop
        if (chunkContext?.onProviderError) await chunkContext.onProviderError(error);
        if (chunkContext?.release && error?.providerOutcome === 'non_billable') {
          // eslint-disable-next-line no-await-in-loop
          await chunkContext.release(error);
        }
        throw error;
      }
      if (afterChunk) {
        // eslint-disable-next-line no-await-in-loop
        await afterChunk({
          result, chunk, chunkIndex, chunkCount: prepared.chunks.length, chunkContext,
        });
      }
      const chunkText = stitchedText ? stripOverlapPrefix(stitchedText, result.text) : result.text;
      stitchedText = [stitchedText, chunkText].filter(Boolean).join(stitchedText && chunkText ? '\n' : '');
      allSegments.push(...result.segments);
      totalUsage = {
        inputQuantity: (totalUsage.inputQuantity || 0) + (result.usage?.inputQuantity || 0),
        outputQuantity: (totalUsage.outputQuantity || 0) + (result.usage?.outputQuantity || 0),
      };
      providerRequestId = result.providerRequestId || providerRequestId;
    }

    return {
      text: stitchedText,
      segments: allSegments,
      usage: totalUsage,
      model,
      providerRequestId,
      contextBiasForwarded: false,
    };
  } finally {
    await Promise.all(cleanupPaths.map((cleanupPath) => unlink(cleanupPath).catch(() => {})));
  }
}

// Same extraction prompt lib/ai-service.js's performOCR already uses.
const OCR_PROMPT = 'Extract every visible word from this document. Preserve headings, paragraphs, lists and tables. Return only faithful Markdown without commentary.';
// Used only when a PDF rasterizes to more than one page (see below) — an
// extra instruction so the model produces one continuous document
// instead of restarting per page or inserting page-break markers.
const OCR_MULTI_PAGE_PROMPT = 'Extract every visible word from this document. The images are consecutive pages of one document, in that order. Preserve headings, paragraphs, lists and tables, and produce one continuous Markdown document for the whole file — do not repeat page numbers or add page-break markers between pages. Return only faithful Markdown without commentary.';

// EdenAI's chat/completions has no working PDF content-block support
// against the hardcoded chat model — confirmed live 2026-08-30: neither
// OpenRouter's `{type:'file', file:{file_data}}` shape nor a `file_id`
// reference reach Mistral's own API successfully (both rejected with
// "Input should be a valid string"), and EdenAI's *dedicated* OCR
// feature's own Mistral engine (`ocr/ocr/mistral` — same OCR product
// OpenRouter's `mistral-ocr` plugin already uses) explicitly rejects
// `application/pdf`, image-only. So a PDF is rasterized to one PNG per
// page (`lib/pdf-rasterize.js`, poppler-based) and sent as multiple
// `image_url` blocks in a single chat message — images need no such
// workaround, `mistral-small-latest` accepts them directly and produces
// markdown/table output matching (in live testing, indistinguishable
// from) the dedicated Mistral OCR engine's own output. See
// migrate-ocr-extraction-to-edenai/design.md for the full comparison.
export async function performOcrEdenAi(filePath, apiKey, mimeType = 'application/pdf', options = {}) {
  const model = options.model;
  if (!model) throw Object.assign(new Error('MODEL_UNAVAILABLE'), { code: 'MODEL_UNAVAILABLE' });

  const isPdf = mimeType === 'application/pdf';
  const imageBuffers = isPdf
    ? await rasterizePdfToImages(filePath)
    : [await readFile(filePath)];
  const imageMimeType = isPdf ? 'image/png' : mimeType;

  const content = [
    { type: 'text', text: imageBuffers.length > 1 ? OCR_MULTI_PAGE_PROMPT : OCR_PROMPT },
    ...imageBuffers.map((buffer) => ({
      type: 'image_url',
      image_url: { url: `data:${imageMimeType};base64,${buffer.toString('base64')}` },
    })),
  ];

  const result = await edenAiJsonRequest('/chat/completions', {
    model,
    messages: [{ role: 'user', content }],
    temperature: 0,
  }, apiKey, options);

  return {
    markdown: result.choices?.[0]?.message?.content || '',
    usage: result.usage || {},
    model: result.model || model,
    providerRequestId: result.id || null,
  };
}

// Mirrors lib/ai-service.js's optimizeText exactly (same preset
// instructions, same prompt shape, same return contract) — only the
// transport differs (EdenAI's /chat/completions instead of OpenRouter's).
// Used by pages/api/text-optimization.js for every text-optimization
// preset once a workspace has activated EdenAI for the `chat`
// capability, including `spelling_grammar` — the dedicated
// text/spell_check adapter this preset used to route to was removed
// (see hardcode-edenai-models/design.md): a real comparison found this
// same prompt through EdenAI chat corrects German text more reliably
// than that dedicated feature did.
export async function optimizeTextEdenAi(text, preset, customInstruction = '', apiKey, model, options = {}) {
  if (!model) throw Object.assign(new Error('MODEL_UNAVAILABLE'), { code: 'MODEL_UNAVAILABLE' });
  const presetInstructions = {
    // Kept identical to lib/ai-service.js's optimizeText — see that
    // file's comment for the full reasoning (three real failure modes
    // found and fixed live, 2026-08-28: synonym substitution, informal
    // contractions expanded to formal forms, and an over-correction of
    // both that suppressed correct capitalization — all verified
    // together across 5 German/English test texts with reruns).
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

  const result = await edenAiJsonRequest('/chat/completions', {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: String(text || '') },
    ],
    temperature: 0.25,
  }, apiKey, options);

  return {
    optimizedText: result.choices?.[0]?.message?.content || '',
    usage: result.usage || {},
    model: result.model || model,
    providerRequestId: result.id || null,
  };
}

// Mirrors lib/tts.js's openRouterTts contract exactly (same params bar
// `language`, which EdenAI's tts subfeature has no field for — voice
// selection alone determines pronunciation/accent; same PCM
// normalization via the shared mp3ToCanonicalPcm helper; same
// Buffer-with-providerRequestId/usage return shape) so call sites branch
// on provider without changing how they consume the result.
//
// EdenAI's tts subfeature is sync (POST /v3/universal-ai, unlike STT's
// async job), confirmed via GET /v3/info/audio/tts — see
// lib/edenai.js's EDENAI_CAPABILITY_MODEL_SHAPE comment. It returns an
// `audio_resource_url` (a signed CloudFront link), not inline audio
// bytes, so this needs a second fetch. That URL is provider-returned,
// not our own fixed endpoint, so it goes through safeFetch (SSRF guard)
// rather than a raw fetch — same reasoning openRouterTts already applies
// to its own upstream call. Confirmed live 2026-08-30: every sample
// across 6 different EdenAI TTS models resolved to the same CloudFront
// host (d14uq1pz7dzsdq.cloudfront.net) — that host needs to be in
// OUTBOUND_ALLOWED_HOSTS wherever that allowlist is enforced (see
// .env.example) — but this is an empirically observed constant, not a
// documented EdenAI API contract; if EdenAI ever rotates their CDN, this
// fails closed (safeFetch throws OUTBOUND_HOST_NOT_ALLOWLISTED) rather
// than silently fetching an unexpected host.
//
// Never omit `voice` and rely on EdenAI's provider default — live
// testing found the unconfigured default voice produced garbled/wrong
// German for nearly every candidate model (see
// lib/edenai.js's EDENAI_HARDCODED_MODEL.tts comment for the evidence).
// Callers should always resolve a real voice (an organization's
// `ttsVoices[model]` override, or EDENAI_TTS_DEFAULT_VOICE) before
// calling this.
export async function synthesizeSpeechEdenAi({
  text, voice, format = 'pcm', apiKey, model, signal = null,
}) {
  const trimmed = (text || '').trim();
  if (!trimmed) return Buffer.alloc(0);
  if (!model) throw Object.assign(new Error('MODEL_UNAVAILABLE'), { code: 'MODEL_UNAVAILABLE' });

  const selectedVoice = voice || EDENAI_TTS_DEFAULT_VOICE;
  const result = await edenAiJsonRequest('/universal-ai', {
    model,
    input: { text: trimmed, voice: selectedVoice, audio_format: 'mp3' },
  }, apiKey, { signal });

  const audioUrl = result?.output?.audio_resource_url;
  if (result?.status !== 'success' || !audioUrl) {
    throw new EdenAiError(
      result?.error?.message
        ? `EdenAI TTS failed: ${result.error.message}`
        : 'EdenAI TTS returned no audio.',
      { status: 502, code: 'TTS_UPSTREAM_ERROR', details: { model, voice: selectedVoice } },
    );
  }

  const audioResponse = await safeFetch(audioUrl, { signal }, { timeoutMs: 30_000 });
  if (!audioResponse.ok) {
    throw new EdenAiError(`EdenAI TTS audio download failed (${audioResponse.status}).`, {
      status: 502,
      code: 'TTS_UPSTREAM_ERROR',
    });
  }

  const upstreamAudio = Buffer.from(await audioResponse.arrayBuffer());
  const audio = format === 'pcm' ? await mp3ToCanonicalPcm(upstreamAudio) : upstreamAudio;
  audio.providerRequestId = null;
  if (Number.isFinite(Number(result.cost))) {
    audio.usage = { cost: Number(result.cost) };
  }
  return audio;
}

// Mirrors lib/ai-service.js's analyzeTranscription exactly — same prompt
// (getAnalysisPrompt, imported rather than duplicated), same
// response_format:{type:'json_object'} contract, same
// sanitizeStructuredValue guard on the parsed result. This is the
// riskiest EdenAI adapter in the migration: OpenRouter exposes a
// `supported_parameters` catalogue signal this app already checks before
// relying on JSON mode (resolveSupportedParameters), and EdenAI has no
// confirmed equivalent (see add-edenai-provider-foundation/design.md's
// Risks section) — so this function's real reliability rests entirely on
// live verification against the hardcoded chat model, not a catalogue
// guarantee. See migrate-chat-to-edenai/design.md for that verification.
export async function analyzeTranscriptionEdenAi(text, template, apiKey, customPrompt = '', model, language = 'de', options = {}) {
  if (!model) throw Object.assign(new Error('MODEL_UNAVAILABLE'), { code: 'MODEL_UNAVAILABLE' });
  const prompt = getAnalysisPrompt(text, template, customPrompt, language);

  const systemContent = language === 'en'
    ? `You are an expert in analyzing transcriptions. Always respond in English and structure your output in JSON format.\n${OUTPUT_QUALITY_GUARD.en}`
    : `Du bist ein Experte für die Analyse von Transkriptionen. Antworte immer auf Deutsch und strukturiert im JSON-Format. Verwende in deutschen Textwerten echte Umlaute (ä, ö, ü, ß) und keine Umschreibungen wie ae, oe oder ue.\n${OUTPUT_QUALITY_GUARD.de}`;

  const result = await edenAiJsonRequest('/chat/completions', {
    model,
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
  }, apiKey, options);

  const content = result.choices?.[0]?.message?.content || '{}';
  let analysis;
  try {
    analysis = JSON.parse(content);
    if (analysis && typeof analysis === 'object' && !Array.isArray(analysis)) {
      analysis = sanitizeStructuredValue(analysis) || {};
    } else {
      analysis = { raw: content };
    }
  } catch {
    analysis = { raw: content };
  }

  return {
    analysis,
    usage: result.usage || {},
    model: result.model || model,
    providerRequestId: result.id || null,
  };
}

// Mirrors lib/ai-service.js's generateTemplate exactly (same prompt,
// same free-text return — no JSON mode here, so this carries none of
// analyzeTranscriptionEdenAi's structured-output risk).
export async function generateTemplateEdenAi(goal, apiKey, model, options = {}) {
  if (!model) throw Object.assign(new Error('MODEL_UNAVAILABLE'), { code: 'MODEL_UNAVAILABLE' });
  const prompt = TEMPLATE_GENERATOR_PROMPT.replace('{{USER_GOAL}}', goal);

  const result = await edenAiJsonRequest('/chat/completions', {
    model,
    messages: [
      { role: 'system', content: 'You are a professional prompt engineer. You output only the final system prompt text, nothing else.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
  }, apiKey, options);

  return {
    promptText: result.choices?.[0]?.message?.content?.trim() || '',
    usage: result.usage || {},
    model: result.model || model,
    providerRequestId: result.id || null,
  };
}
