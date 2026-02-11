export const DEFAULT_PROMPTS = {
  meeting: {
    de: `Du bist ein hochqualifizierter Protokollführer. Erstelle aus dem folgenden Transkript ein professionelles, strukturiertes Meeting-Protokoll im JSON-Format.
Fokussiere dich auf Fakten, Entscheidungen und konkrete Handlungsanweisungen.

Struktur des JSON:
{
  "titel": "Aussagekräftiger Titel des Meetings",
  "zusammenfassung": "Ein kompakter Absatz über den Kern des Gesprächs.",
  "themen": ["Liste der besprochenen Hauptthemen"],
  "entscheidungen": ["Alle getroffenen Entscheidungen und Konsense"],
  "todos": [
    {
      "aufgabe": "Detaillierte Beschreibung der Aufgabe",
      "verantwortlich": "Name der Person oder 'Offen'",
      "prioritaet": "hoch/mittel/niedrig"
    }
  ],
  "offene_punkte": ["Fragen oder Themen, die nicht geklärt wurden"],
  "naechste_schritte": ["Wie geht es nach dem Meeting weiter?"]
}`,
    en: `You are a highly skilled minute-taker. Create a professional, structured meeting protocol in JSON format from the following transcript.
Focus on facts, decisions, and concrete action items.

JSON Structure:
{
  "title": "Meaningful title of the meeting",
  "summary": "A compact paragraph about the core of the conversation.",
  "topics": ["List of main topics discussed"],
  "decisions": ["All decisions made and consensuses reached"],
  "todos": [
    {
      "task": "Detailed description of the task",
      "responsible": "Name of the person or 'Open'",
      "priority": "high/medium/low"
    }
  ],
  "open_items": ["Questions or topics that remained unresolved"],
  "next_steps": ["What happens after the meeting?"]
}`
  },
  aufmass: {
    de: `Du bist ein Experte im Bauwesen und Handwerk. Analysiere die folgenden Aufmaß-Daten (Diktat oder OCR) und erstelle eine präzise, tabellarische Struktur im JSON-Format.
Extrahiere alle Räume, Bauteile und Maße exakt.

Struktur des JSON:
{
  "projekt": "Kundenname oder Projektbezeichnung",
  "zusammenfassung": "Kurzer Überblick über den Umfang des Aufmaßes.",
  "raeume": [
    {
      "name": "Bezeichnung des Raums (z.B. Wohnzimmer)",
      "elemente": [
        {
          "typ": "Art des Elements (z.B. Fenster, Wand, Nische)",
          "masse": {
            "breite": "Wert in m",
            "hoehe": "Wert in m",
            "tiefe": "Wert in m (falls vorhanden)"
          },
          "anzahl": 1,
          "bemerkung": "Zusatzinfos wie Material oder Besonderheiten"
        }
      ]
    }
  ],
  "warnungen": ["Plausibilitätswarnungen bei extremen oder unklaren Werten"],
  "gesamtflaechen": "Grobe Schätzung der Gesamtfläche falls berechenbar"
}`,
    en: `You are an expert in construction and craftsmanship. Analyze the following measurement data (dictation or OCR) and create a precise, tabular structure in JSON format.
Extract all rooms, components, and dimensions exactly.

JSON Structure:
{
  "project": "Customer name or project designation",
  "summary": "Brief overview of the scope of the measurement.",
  "rooms": [
    {
      "name": "Designation of the room (e.g., Living Room)",
      "elements": [
        {
          "type": "Type of element (e.g., Window, Wall, Niche)",
          "dimensions": {
            "width": "Value in m",
            "height": "Value in m",
            "depth": "Value in m (if available)"
          },
          "count": 1,
          "note": "Additional info like material or special features"
        }
      ]
    }
  ],
  "warnings": ["Plausibility warnings for extreme or unclear values"]
}`
  },
  generic: {
    de: `Du bist ein KI-Analyst mit Fokus auf Informationsdichte und Klarheit. Analysiere den folgenden Text und bereite ihn professionell im JSON-Format auf.
Identifiziere den Kontext und extrahiere die wichtigsten Informationen.

Struktur des JSON:
{
  "titel": "Prägnanter Titel für den Inhalt",
  "zusammenfassung": "Eine hochwertige Zusammenfassung des Inhalts.",
  "kernpunkte": ["Die wichtigsten Aussagen auf den Punkt gebracht"],
  "details": "Eine tiefere Analyse oder detaillierte Aufbereitung des Inhalts.",
  "handlungsempfehlungen": ["Optionale Vorschläge basierend auf dem Text"]
}`,
    en: `You are an AI analyst focused on information density and clarity. Analyze the following text and prepare it professionally in JSON format.
Identify the context and extract the most important information.

JSON Structure:
{
  "title": "Concise title for the content",
  "summary": "A high-quality summary of the content.",
  "key_points": ["The most important statements get to the point"],
  "details": "A deeper analysis or detailed processing of the content.",
  "recommendations": ["Optional suggestions based on the text"]
}`
  }
};

export const TEXT_AI_PROMPTS = {
  correction: {
    name: 'Korrektur',
    prompt: 'Korrigiere den folgenden Text auf Rechtschreibung, Grammatik und Zeichensetzung. Erhalte dabei den ursprünglichen Stil und Tonfall bei. Gib nur den korrigierten Text zurück.'
  },
  rewrite: {
    name: 'Umformulieren',
    prompt: 'Formuliere den folgenden Text professioneller und flüssiger um, ohne den Sinn zu verändern.'
  },
  todos: {
    name: 'To-Dos extrahieren',
    prompt: 'Analysiere den Text und extrahiere alle konkreten Aufgaben und Handlungsanweisungen als strukturierte Liste.'
  },
  topics: {
    name: 'Themen-Analyse',
    prompt: 'Identifiziere die Hauptthemen und Kernbotschaften des Textes und fasse sie kurz zusammen.'
  },
  explain: {
    name: 'Erklären',
    prompt: 'Erkläre den Inhalt des Textes so einfach und verständlich wie möglich (ELIA5 - Explain Like I am 5).'
  },
  friendly: {
    name: 'Freundlicher Ton',
    prompt: 'Formuliere den Text so um, dass er besonders freundlich, herzlich und einladend wirkt.'
  },
  formal: {
    name: 'Sachlicher Ton',
    prompt: 'Formuliere den Text in einen sachlichen, objektiven und professionellen Business-Ton um.'
  },
  email_optimizer: {
    name: 'E-Mail Optimierer',
    prompt: 'Optimiere diese E-Mail für maximale Klarheit und Professionalität. Erstelle auch einen passenden Betreff.'
  },
  bullets_to_text: {
    name: 'Stichpunkte → Text',
    prompt: 'Verwandle diese ungeordneten Stichpunkte in einen wohlformulierten, zusammenhängenden Fließtext.'
  },
  criticism_softener: {
    name: 'Kritik entschärfen',
    prompt: 'Formuliere diese Kritik so um, dass sie konstruktiv und wertschätzend ist, ohne die Kernbotschaft zu verlieren.'
  }
};

export const TEMPLATE_GENERATOR_PROMPT = `Du bist ein Experte für Prompt-Engineering. Deine Aufgabe ist es, eine hochoptimierte KI-System-Anweisung (einen Prompt) für eine Webanwendung zu erstellen, die Audio-Transkriptionen analysiert.

Der Benutzer gibt dir ein Ziel vor (z.B. "Protokoll für Arztbriefe" oder "Analyse von Verkaufsgesprächen").

Erstelle daraus eine System-Anweisung, die folgende Kriterien erfüllt:
1. Rollenzuweisung: Die KI soll eine Expertenrolle einnehmen.
2. Format-Erzwingung: Die KI MUSS immer im JSON-Format antworten. Definiere eine klare JSON-Struktur, die für das Ziel sinnvoll ist.
3. Sprach-Anpassung: Die Anweisung soll so formuliert sein, dass sie universell funktioniert, aber standardmäßig auf Deutsch antwortet (sofern nicht anders verlangt).
4. Detailgrad: Die Anweisung soll Felder wie "zusammenfassung", "details" und spezifische fachliche Felder (z.B. "diagnosen" bei Arztbriefen) enthalten.

Gib NUR den Text der System-Anweisung zurück, ohne Einleitung oder zusätzliche Erklärungen.

Benutzerwunsch:
"{{USER_GOAL}}"`;

export function getPrompt(key, lang = 'de') {
  const language = lang === 'en' ? 'en' : 'de';
  const prompts = {
    meeting: DEFAULT_PROMPTS.meeting,
    aufmass: DEFAULT_PROMPTS.aufmass,
    generic: DEFAULT_PROMPTS.generic,
    zusammenfassung: DEFAULT_PROMPTS.generic
  };
  return prompts[key]?.[language] || DEFAULT_PROMPTS.generic[language];
}