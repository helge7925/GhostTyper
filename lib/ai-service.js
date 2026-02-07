import { readFile } from 'fs/promises';

const MISTRAL_API_URL = 'https://api.mistral.ai/v1';
const TRANSCRIPTION_MODEL = 'pixtral-large-latest'; // Voxtral/Pixtral for audio
const ANALYSIS_MODEL = 'mistral-large-latest';       // Mistral Large for text analysis

async function mistralRequest(endpoint, body, apiKey) {
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
  const base64Audio = audioBuffer.toString('base64');
  const mimeType = filePath.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';

  const result = await mistralRequest('/chat/completions', {
    model: TRANSCRIPTION_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'audio',
            data: base64Audio,
            mime_type: mimeType,
          },
          {
            type: 'text',
            text: 'Transkribiere diese Audioaufnahme vollständig auf Deutsch. Gib nur den transkribierten Text zurück, ohne Kommentare oder Erklärungen.',
          },
        ],
      },
    ],
  }, apiKey);

  return result.choices[0]?.message?.content || '';
}

export async function analyzeTranscription(text, template, apiKey) {
  const prompt = getAnalysisPrompt(text, template);

  const result = await mistralRequest('/chat/completions', {
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
