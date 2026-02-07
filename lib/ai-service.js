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

export async function transcribeAudio(filePath, apiKey) {
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

  // Voxtral Mini uses the /audio/transcriptions endpoint with multipart form data
  const blob = new Blob([audioBuffer], { type: mimeType });
  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('model', TRANSCRIPTION_MODEL);
  formData.append('language', 'de');

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
  return result.text || '';
}

export async function analyzeTranscription(text, template, apiKey) {
  const prompt = getAnalysisPrompt(text, template);

  const result = await mistralJsonRequest('/chat/completions', {
    model: ANALYSIS_MODEL,
    messages: [
      {
        role: 'system',
        content: 'Du bist ein Experte für die Analyse von Transkriptionen. Antworte immer auf Deutsch und strukturiert im JSON-Format.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    response_format: { type: 'json_object' },
  }, apiKey);

  const content = result.choices[0]?.message?.content || '{}';

  try {
    return JSON.parse(content);
  } catch {
    return { raw: content };
  }
}

function getAnalysisPrompt(text, template) {
  switch (template) {
    case 'meeting':
      return getMeetingPrompt(text);
    case 'aufmass':
      return getAufmassPrompt(text);
    default:
      return getGenericPrompt(text);
  }
}

function getMeetingPrompt(text) {
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

function getAufmassPrompt(text) {
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

function getGenericPrompt(text) {
  return `Analysiere den folgenden Text und erstelle ein strukturiertes JSON mit:

{
  "zusammenfassung": "Kurze Zusammenfassung",
  "kernpunkte": ["Wichtigste Punkte"],
  "details": "Detaillierte Aufbereitung des Inhalts"
}

Text:
${text}`;
}
