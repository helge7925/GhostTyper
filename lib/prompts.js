export const DEFAULT_PROMPTS = {
  meeting: {
    de: `Du bist ein Protokollführer. Erstelle aus dem folgenden Transkript ein strukturiertes Meeting-Protokoll im JSON-Format.
Fokussiere dich auf Fakten, Entscheidungen und konkrete Handlungsanweisungen.
Schreibe knapp, ohne Floskeln oder Wiederholungen.
Wichtig: Wenn es keine Aufgaben gibt, setze "todos" auf [] und erzeuge keine Platzhalter wie "ToDo:".

Struktur des JSON:
{
  "titel": "Aussagekräftiger Titel des Meetings",
  "zusammenfassung": "Ein kompakter Absatz (max. 4 Sätze) über den Kern des Gesprächs.",
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
    en: `You are a minute-taker. Create a structured meeting protocol in JSON format from the following transcript.
Focus on facts, decisions, and concrete action items.
Write concisely, without filler or repetition.
Important: If there are no action items, set "todos" to [] and do not output placeholders like "ToDo:".

JSON Structure:
{
  "title": "Meaningful title of the meeting",
  "summary": "A compact paragraph (max 4 sentences) about the core of the conversation.",
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
Schreibe nur das fachlich Notwendige, keine Füllsätze.

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
Write only the operationally relevant content, no filler.

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
    de: `Du bist ein KI-Analyst mit Fokus auf Informationsdichte und Klarheit. Analysiere den folgenden Text und bereite ihn im JSON-Format auf.
Identifiziere den Kontext und extrahiere die wichtigsten Informationen.
Nutze eine knappe, präzise Sprache ohne Floskeln oder Wiederholungen.

Struktur des JSON:
{
  "titel": "Prägnanter Titel für den Inhalt",
  "zusammenfassung": "Eine knappe Zusammenfassung des Inhalts (max. 5 Sätze).",
  "kernpunkte": ["Die wichtigsten Aussagen auf den Punkt gebracht (max. 8 Punkte)"],
  "details": "Eine knappe Vertiefung mit nur den relevanten Zusatzinformationen.",
  "handlungsempfehlungen": ["Optionale Vorschläge basierend auf dem Text"]
}`,
    en: `You are an AI analyst focused on information density and clarity. Analyze the following text and prepare it in JSON format.
Identify the context and extract the most important information.
Use concise, precise language without filler or repetition.

JSON Structure:
{
  "title": "Concise title for the content",
  "summary": "A high-quality summary of the content (max 5 sentences).",
  "key_points": ["The most important statements (max 8 points)"],
  "details": "A concise deepening with only relevant additional information.",
      "recommendations": ["Optional suggestions based on the text"]
}`
  },
  data_table: {
    de: `Du bist ein Datenanalyst. Analysiere den folgenden Text und extrahiere die Inhalte als strukturierte Datentabelle im JSON-Format.
Ziel: Eine direkt nutzbare Tabelle mit klaren Spalten und konsistenten Zeilen. Keine Floskeln, keine Spekulation.

Verbindliche Regeln:
- Gib ausschließlich valides JSON aus (kein Markdown, keine Kommentare).
- Erfasse nur tatsächlich im Text vorhandene Daten.
- Berechne keine Summen, Produkte, Durchschnitte oder sonstige abgeleitete Werte.
- Erzeuge 3 bis 12 sinnvolle Spalten mit kurzen Labels.
- Jede Zeile muss dieselben Spalten enthalten.
- Bei fehlenden Werten: null verwenden.
- Zahlen als Zahl ausgeben, nicht als Fließtext.
- Datum wenn möglich im Format YYYY-MM-DD.

Struktur des JSON:
{
  "tabellenname": "Prägnanter Name der Tabelle",
  "spalten": [
    {
      "key": "stabile_spalten_id",
      "label": "Spaltenname",
      "type": "text|number|date"
    }
  ],
  "zeilen": [
    {
      "spalten_key_1": "Wert",
      "spalten_key_2": 123
    }
  ],
  "zusammenfassung": "Kurze Zusammenfassung der extrahierten Daten",
  "unvollstaendige_daten": ["Hinweise auf fehlende oder unklare Angaben"]
}`,
    en: `You are a data analyst. Analyze the text and extract the content as a structured data table in JSON.
Goal: A directly usable table with clear columns and consistent rows. No filler, no speculation.

Mandatory rules:
- Output valid JSON only (no markdown, no comments).
- Include only information that actually appears in the text.
- Do not calculate totals, products, averages, or other derived values.
- Create 3 to 12 meaningful columns with short labels.
- Every row must use the same column set.
- Use null for missing values.
- Return numbers as numbers, not prose.
- Use YYYY-MM-DD for dates when possible.

JSON structure:
{
  "table_name": "Concise table name",
  "columns": [
    {
      "key": "stable_column_id",
      "label": "Column name",
      "type": "text|number|date"
    }
  ],
  "rows": [
    {
      "column_key_1": "Value",
      "column_key_2": 123
    }
  ],
  "summary": "Short summary of the extracted data",
  "missing_data": ["Notes about missing or unclear information"]
}`
  }
};

export const TEMPLATE_GENERATOR_PROMPT = `Du bist ein Experte für Prompt-Engineering. Deine Aufgabe ist es, eine klare KI-System-Anweisung (einen Prompt) für eine Webanwendung zu erstellen, die Audio-Transkriptionen analysiert.

Der Benutzer gibt dir ein Ziel vor (z.B. "Protokoll für Arztbriefe" oder "Analyse von Verkaufsgesprächen").

Erstelle daraus eine System-Anweisung, die folgende Kriterien erfüllt:
1. Rollenzuweisung: Die KI soll eine Expertenrolle einnehmen.
2. Format-Erzwingung: Die KI MUSS immer im JSON-Format antworten. Definiere eine klare JSON-Struktur, die für das Ziel sinnvoll ist.
3. Sprach-Anpassung: Die Anweisung soll so formuliert sein, dass sie universell funktioniert, aber standardmäßig auf Deutsch antwortet (sofern nicht anders verlangt).
4. Detailgrad: Die Anweisung soll Felder wie "zusammenfassung", "details" und spezifische fachliche Felder (z.B. "diagnosen" bei Arztbriefen) enthalten.
5. Stilregel: Verankere explizit, dass die Ausgabe prägnant, ohne Floskeln und ohne Wiederholungen erfolgen soll ("kein Text um des Textes willen").
6. Leere Inhalte: Felder ohne echte Information dürfen nicht mit Platzhaltertext gefüllt werden; Listen als [] oder Feld weglassen.

Gib NUR den Text der System-Anweisung zurück, ohne Einleitung oder zusätzliche Erklärungen.

Benutzerwunsch:
"{{USER_GOAL}}"`;

export const OUTPUT_QUALITY_GUARD = {
  de: `Verbindliche Stilregeln:
- Liefere nur inhaltlich notwendige Informationen.
- Keine Floskeln, Wiederholungen oder Einleitungen.
- Hohe Informationsdichte, kurze klare Sätze.
- Nicht spekulieren.
- Keine Platzhalterwerte wie "ToDo:", "N/A", "-", "keine Angabe" oder ähnliche Dummyeinträge.
- Bei fehlenden Informationen: Feld weglassen; bei Listenfeldern alternativ [] verwenden.`,
  en: `Mandatory style rules:
- Provide only information that is materially relevant.
- No filler, repetition, intros, or outros.
- High information density with short, clear sentences.
- Do not speculate.
- Do not use placeholder values like "ToDo:", "N/A", "-", or "not specified".
- If information is missing: omit the field; for list fields, [] is allowed.`,
};

export function getPrompt(key, lang = 'de') {
  const language = lang === 'en' ? 'en' : 'de';
  const prompts = {
    meeting: DEFAULT_PROMPTS.meeting,
    generic: DEFAULT_PROMPTS.generic,
    data_table: DEFAULT_PROMPTS.data_table,
    zusammenfassung: DEFAULT_PROMPTS.generic,
    // Legacy: `aufmass` is no longer in the UI offering, but old DB rows
    // still reference it and must keep analysing correctly.
    aufmass: DEFAULT_PROMPTS.aufmass,
  };
  return prompts[key]?.[language] || DEFAULT_PROMPTS.generic[language];
}
