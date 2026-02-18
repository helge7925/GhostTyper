import { readFile, unlink } from 'fs/promises';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { DEFAULT_PROMPTS, getPrompt, OUTPUT_QUALITY_GUARD, TEMPLATE_GENERATOR_PROMPT } from './prompts';
import { sanitizeStructuredValue } from './analysis-cleaner';
import { logError, logInfo, logWarn } from './observability';

const MISTRAL_API_URL = 'https://api.mistral.ai/v1';
const TRANSCRIPTION_MODEL = 'voxtral-mini-latest';
const ANALYSIS_MODEL = 'mistral-large-latest';
const TRANSLATION_MODEL = 'mistral-medium-latest';

async function convertAudioToMp3(inputPath) {
  const outputPath = inputPath.replace(/\.[^.]+$/, '.mp3');
  
  // Ensure ffmpeg path is set (standard Alpine location)
  try {
    ffmpeg.setFfmpegPath('/usr/bin/ffmpeg');
  } catch (e) {}

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

async function mistralJsonRequest(endpoint, body, apiKey) {
  const response = await fetch(`${MISTRAL_API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logWarn('mistral.api_error', { endpoint, status: response.status });
    let errorMessage = response.statusText;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.message || errorMessage;
    } catch (e) {}
    throw new Error(`Mistral API error: ${response.status} - ${errorMessage}`);
  }

  return response.json();
}

/**
 * Transcribe audio using Voxtral Mini via /audio/transcriptions.
 * Returns { text, segments } where segments contain speaker info if diarize=true.
 */
export async function transcribeAudio(filePath, apiKey, options = {}) {
  const { diarize = false, contextBias = [], language = 'de' } = options;

  let fileToProcess = filePath;
  let converted = false;
  const ext = path.extname(filePath).toLowerCase();

  // Convert WebM/OGG to MP3 as Mistral might not support them reliably
  if (ext === '.webm' || ext === '.ogg') {
    try {
      fileToProcess = await convertAudioToMp3(filePath);
      converted = true;
    } catch (error) {
      logError('audio.conversion_exception', error, { filePath });
      throw new Error('Audio-Konvertierung fehlgeschlagen. Bitte versuchen Sie es erneut oder nutzen Sie ein anderes Format.');
    }
  }

  try {
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
    // Using a Blob from the buffer ensures the correct Content-Type in the multipart part
    const fileBlob = new Blob([audioBuffer], { type: mimeType });
    formData.append('file', fileBlob, filename);
    formData.append('model', TRANSCRIPTION_MODEL);
    formData.append('language', language);

    if (diarize) {
      formData.append('diarize', 'true');
      formData.append('timestamp_granularities', 'segment');
    }

    if (contextBias.length > 0) {
      formData.append('context_bias', contextBias.join(','));
    }

    const response = await fetch(`${MISTRAL_API_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Mistral transcription error: ${response.status} - ${error.message || response.statusText}`);
    }

    const result = await response.json();

    return {
      text: result.text || '',
      segments: result.segments || [],
      usage: result.usage || {},
      model: TRANSCRIPTION_MODEL,
    };
  } finally {
    if (converted) {
      await unlink(fileToProcess).catch(() => {});
    }
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
 * Analyze transcription text using Mistral Large.
 * Accepts optional customPrompt for additional user context.
 */
export async function analyzeTranscription(text, template, apiKey, customPrompt = '', model = null, language = 'de') {
  const prompt = getAnalysisPrompt(text, template, customPrompt, language);
  const usedModel = model || ANALYSIS_MODEL;

  const systemContent = language === 'en'
    ? `You are an expert in analyzing transcriptions. Always respond in English and structure your output in JSON format.\n${OUTPUT_QUALITY_GUARD.en}`
    : `Du bist ein Experte für die Analyse von Transkriptionen. Antworte immer auf Deutsch und strukturiert im JSON-Format. Verwende in deutschen Textwerten echte Umlaute (ä, ö, ü, ß) und keine Umschreibungen wie ae, oe oder ue.\n${OUTPUT_QUALITY_GUARD.de}`;

  const result = await mistralJsonRequest('/chat/completions', {
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
  }, apiKey);

  const content = result.choices[0]?.message?.content || '{}';

  let analysis;
  try {
    analysis = JSON.parse(content);
    if (analysis && typeof analysis === 'object') {
      analysis = sanitizeStructuredValue(analysis) || {};
    }
  } catch {
    analysis = { raw: content };
  }

  return {
    analysis,
    usage: result.usage || {},
    model: usedModel,
  };
}

/**
 * Translate text using Mistral Medium.
 */
export async function translateText(text, targetLanguage, sourceLanguage = 'auto', apiKey, model = null) {
  const usedModel = model || TRANSLATION_MODEL;
  
  const systemPrompt = `You are a professional translator. Translate the provided text into ${targetLanguage}. 
${sourceLanguage !== 'auto' ? `The source language is ${sourceLanguage}.` : 'Detect the source language automatically.'}
Maintain the original tone and nuances. 

IMPORTANT: The input may contain HTML tags or Markdown formatting. 
1. Keep all structural elements (paragraphs, headers, lists, tables) exactly as they are.
2. If the input is HTML, return valid HTML. If it is Markdown, return valid Markdown.
3. Only return the translated content without any explanations or preamble.`;

  const result = await mistralJsonRequest('/chat/completions', {
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
  }, apiKey);

  return {
    translatedText: result.choices[0]?.message?.content || '',
    usage: result.usage || {},
    model: usedModel,
  };
}

/**
 * Upload a file to Mistral Files API.
 */
async function uploadFileToMistral(filePath, apiKey, mimeType = 'application/octet-stream') {
  const fileBuffer = await readFile(filePath);
  const filename = path.basename(filePath);
  const blob = new Blob([fileBuffer], { type: mimeType });
  
  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('purpose', 'ocr');

  const response = await fetch(`${MISTRAL_API_URL}/files`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Mistral file upload error: ${response.status} - ${error.message || response.statusText}`);
  }

  return response.json();
}

/**
 * Delete a file from Mistral Files API.
 */
async function deleteFileFromMistral(fileId, apiKey) {
  const response = await fetch(`${MISTRAL_API_URL}/files/${fileId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    logWarn('mistral.file_delete_failed', { fileId, status: response.status });
  }
}

/**
 * Perform OCR on a file using Mistral OCR.
 */
export async function performOCR(filePath, apiKey, mimeType = 'application/pdf') {
  const OCR_MODEL = 'mistral-ocr-latest';
  let fileId = null;

  try {
    // 1. Upload file
    const uploadResult = await uploadFileToMistral(filePath, apiKey, mimeType);
    fileId = uploadResult.id;

    // 2. Small delay to ensure file is ready in Mistral's storage
    await new Promise(resolve => setTimeout(resolve, 1500));

    // 3. Get signed URL for the file
    const signedUrlResult = await fetch(`${MISTRAL_API_URL}/files/${fileId}/url`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    
    if (!signedUrlResult.ok) {
      throw new Error(`Failed to get signed URL for OCR: ${signedUrlResult.status}`);
    }
    
    const { url: signedUrl } = await signedUrlResult.json();

    // 4. Process OCR
    const ocrResult = await mistralJsonRequest('/ocr', {
      model: OCR_MODEL,
      document: {
        type: 'document_url',
        document_url: signedUrl,
      },
    }, apiKey);

    // 5. Combine Markdown from all pages
    const markdown = ocrResult.pages?.map(p => p.markdown).join('\n\n') || '';

    return {
      markdown,
      usage: ocrResult.usage || {},
      model: OCR_MODEL,
    };
  } finally {
    // 6. Cleanup
    if (fileId) {
      await deleteFileFromMistral(fileId, apiKey);
    }
  }
}

function getAnalysisPrompt(text, template, customPrompt = '', language = 'de') {
  let basePrompt;

  if (template === 'meeting' || template === 'aufmass' || template === 'generic') {
    basePrompt = `${getPrompt(template, language)}\n\n${language === 'en' ? 'Transcript' : 'Transkript'}:\n${text}`;
  } else {
    // Treat as custom template / custom prompt text
    const transcriptLabel = language === 'en' ? 'Transcript' : 'Transkript';
    basePrompt = `${template}\n\n${transcriptLabel}:\n${text}`;
  }

  if (customPrompt) {
    const label = language === 'en' ? 'Additional context from user' : 'Zusätzlicher Kontext vom Benutzer';
    basePrompt += `\n\n${label}:\n${customPrompt}`;
  }

  basePrompt += `\n\n${language === 'en' ? OUTPUT_QUALITY_GUARD.en : OUTPUT_QUALITY_GUARD.de}`;

  return basePrompt;
}

/**
 * Generate a new template prompt based on a user's goal.
 */
export async function generateTemplate(goal, apiKey) {
  const prompt = TEMPLATE_GENERATOR_PROMPT.replace('{{USER_GOAL}}', goal);

  const result = await mistralJsonRequest('/chat/completions', {
    model: ANALYSIS_MODEL,
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
  }, apiKey);

  return {
    promptText: result.choices[0]?.message?.content?.trim() || '',
    usage: result.usage || {},
    model: ANALYSIS_MODEL,
  };
}
