import { readFile } from 'fs/promises';
import path from 'path';

const MISTRAL_API_URL = 'https://api.mistral.ai/v1';
const TRANSCRIPTION_MODEL = 'voxtral-mini-latest';
const ANALYSIS_MODEL = 'mistral-large-latest';

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
    const error = await response.json().catch(() => ({}));
    throw new Error(`Mistral API error: ${response.status} - ${error.message || response.statusText}`);
  }

  return response.json();
}

/**
 * Transcribe audio using Voxtral Mini via /audio/transcriptions.
 * Returns { text, segments } where segments contain speaker info if diarize=true.
 */
export async function transcribeAudio(filePath, apiKey, options = {}) {
  const { diarize = false, contextBias = [], language = 'de' } = options;

  const audioBuffer = await readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();

  const mimeTypes = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.webm': 'audio/webm',
  };
  const mimeType = mimeTypes[ext] || 'audio/mpeg';
  const filename = path.basename(filePath);

  const blob = new Blob([audioBuffer], { type: mimeType });
  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('model', TRANSCRIPTION_MODEL);
  formData.append('language', language);

  if (diarize) {
    formData.append('diarize', 'true');
    formData.append('timestamp_granularities', 'segment');
  }

  if (contextBias.length > 0) {
    formData.append('context_bias', JSON.stringify(contextBias));
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
    ? 'You are an expert in analyzing transcriptions. Always respond in English and structure your output in JSON format.'
    : 'Du bist ein Experte für die Analyse von Transkriptionen. Antworte immer auf Deutsch und strukturiert im JSON-Format.';

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
  } catch {
    analysis = { raw: content };
  }

  return {
    analysis,
    usage: result.usage || {},
    model: usedModel,
  };
}

function getAnalysisPrompt(text, template, customPrompt = '', language = 'de') {
  let basePrompt;

  switch (template) {
    case 'meeting':
      basePrompt = getMeetingPrompt(text, language);
      break;
    case 'aufmass':
      basePrompt = getAufmassPrompt(text, language);
      break;
    default:
      basePrompt = getGenericPrompt(text, language);
  }

  if (customPrompt) {
    const label = language === 'en' ? 'Additional context from user' : 'Zusätzlicher Kontext vom Benutzer';
    basePrompt += `\n\n${label}:\n${customPrompt}`;
  }

  return basePrompt;
}

function getMeetingPrompt(text, language = 'de') {
  if (language === 'en') {
    return `Analyze the following meeting transcript and create a structured JSON with:

{
  "summary": "Brief summary of the meeting",
  "topics": ["Discussed topics"],
  "todos": [
    {
      "task": "Description",
      "responsible": "Person or 'unknown'",
      "priority": "high/medium/low",
      "deadline": "if mentioned, otherwise null"
    }
  ],
  "decisions": ["Decisions made"],
  "open_items": ["Unresolved questions or topics"],
  "next_steps": ["Next steps"]
}

Transcript:
${text}`;
  }

  return `Analysiere das folgende Meeting-Transkript und erstelle ein strukturiertes JSON mit:

{
  "zusammenfassung": "Kurze Zusammenfassung des Meetings",
  "themen": ["Besprochene Themen"],
  "todos": [
    {
      "aufgabe": "Beschreibung",
      "verantwortlich": "Person oder 'unbekannt'",
      "prioritaet": "hoch/mittel/niedrig",
      "deadline": "falls genannt, sonst null"
    }
  ],
  "entscheidungen": ["Getroffene Entscheidungen"],
  "offene_punkte": ["Ungeklärte Fragen oder Themen"],
  "naechste_schritte": ["Nächste Schritte"]
}

Transkript:
${text}`;
}

function getAufmassPrompt(text, language = 'de') {
  if (language === 'en') {
    return `Analyze the following measurement data and structure it as JSON:

{
  "project": "Project name if identifiable",
  "rooms": [
    {
      "name": "Room designation",
      "elements": [
        {
          "type": "Window/Door/Wall/etc.",
          "dimensions": {
            "width": "Value in m",
            "height": "Value in m",
            "depth": "Value in m if relevant"
          },
          "count": 1,
          "note": "Additional info"
        }
      ]
    }
  ],
  "warnings": ["Plausibility warnings for unrealistic values"],
  "summary": "Overall overview"
}

Measurement data:
${text}`;
  }

  return `Analysiere die folgenden Aufmaß-Daten und strukturiere sie als JSON:

{
  "projekt": "Projektname falls erkennbar",
  "raeume": [
    {
      "name": "Raumbezeichnung",
      "elemente": [
        {
          "typ": "Fenster/Tür/Wand/etc.",
          "masse": {
            "breite": "Wert in m",
            "hoehe": "Wert in m",
            "tiefe": "Wert in m falls relevant"
          },
          "anzahl": 1,
          "bemerkung": "Zusätzliche Infos"
        }
      ]
    }
  ],
  "warnungen": ["Plausibilitätswarnungen für unrealistische Werte"],
  "zusammenfassung": "Gesamtübersicht"
}

Aufmaß-Daten:
${text}`;
}

function getGenericPrompt(text, language = 'de') {
  if (language === 'en') {
    return `Analyze the following text and create a structured JSON with:

{
  "summary": "Brief summary",
  "key_points": ["Most important points"],
  "details": "Detailed elaboration of the content"
}

Text:
${text}`;
  }

  return `Analysiere den folgenden Text und erstelle ein strukturiertes JSON mit:

{
  "zusammenfassung": "Kurze Zusammenfassung",
  "kernpunkte": ["Wichtigste Punkte"],
  "details": "Detaillierte Aufbereitung des Inhalts"
}

Text:
${text}`;
}
