/**
 * Generiert ein Tabellen-Schema basierend auf einer Benutzerbeschreibung
 * Dies wird clientseitig aufgerufen, aber kann auch serverseitig mit KI erweitert werden
 */

/**
 * Erstellt ein Basis-Schema aus einer Beschreibung (lokale Heuristik)
 */
export function generateSchemaFromDescription(description) {
  const lowerDesc = description.toLowerCase();
  
  // Erkennung von Mustern
  const isInvoice = lowerDesc.includes('rechnung') || lowerDesc.includes('invoice');
  const isOrder = lowerDesc.includes('bestellung') || lowerDesc.includes('auftrag');
  const isInventory = lowerDesc.includes('inventar') || lowerDesc.includes('bestand');
  const isTimeTracking = lowerDesc.includes('zeiterfassung') || lowerDesc.includes('stundenzettel');
  const isMeeting = lowerDesc.includes('meeting') || lowerDesc.includes('besprechung');
  const isContact = lowerDesc.includes('kontakt') || lowerDesc.includes('adresse');
  
  if (isInvoice || isOrder) {
    return createInvoiceSchema(description);
  } else if (isInventory) {
    return createInventorySchema(description);
  } else if (isTimeTracking) {
    return createTimeTrackingSchema(description);
  } else if (isMeeting) {
    return createMeetingSchema(description);
  } else if (isContact) {
    return createContactSchema(description);
  }
  
  // Generisches Schema
  return createGenericSchema(description);
}

function createInvoiceSchema(description) {
  return {
    tableName: 'Rechnungspositionen',
    description: description || 'Extrahiert Rechnungs- oder Bestellpositionen aus Text',
    columns: [
      { key: 'pos', label: 'Pos.', type: 'number', required: true, editable: true },
      { key: 'artikel', label: 'Artikel / Leistung', type: 'text', required: true, editable: true },
      { key: 'menge', label: 'Menge', type: 'number', required: true, editable: true },
      { key: 'einheit', label: 'Einheit', type: 'text', required: false, editable: true },
      { key: 'einzelpreis', label: 'Einzelpreis', type: 'currency', required: true, editable: true },
    ],
    rows: [],
    calculations: [
      {
        key: 'gesamt',
        label: 'Gesamt',
        type: 'currency',
        formula: 'menge * einzelpreis',
        displayInTable: true,
        displayInFooter: true
      }
    ]
  };
}

function createInventorySchema(description) {
  return {
    tableName: 'Inventarliste',
    description: description || 'Extrahiert Inventardaten aus Text',
    columns: [
      { key: 'artikelnr', label: 'Artikel-Nr.', type: 'text', required: false, editable: true },
      { key: 'bezeichnung', label: 'Bezeichnung', type: 'text', required: true, editable: true },
      { key: 'lagerort', label: 'Lagerort', type: 'text', required: false, editable: true },
      { key: 'bestand', label: 'Bestand', type: 'number', required: true, editable: true },
      { key: 'mindestbestand', label: 'Mindestbestand', type: 'number', required: false, editable: true },
      { key: 'einzelpreis', label: 'Einzelpreis', type: 'currency', required: false, editable: true },
    ],
    rows: [],
    calculations: [
      {
        key: 'bestandswert',
        label: 'Bestandswert',
        type: 'currency',
        formula: 'bestand * einzelpreis',
        displayInTable: true,
        displayInFooter: true
      }
    ]
  };
}

function createTimeTrackingSchema(description) {
  return {
    tableName: 'Stundenzettel',
    description: description || 'Extrahiert Zeiterfassungsdaten aus Text',
    columns: [
      { key: 'datum', label: 'Datum', type: 'date', required: true, editable: true },
      { key: 'mitarbeiter', label: 'Mitarbeiter', type: 'text', required: false, editable: true },
      { key: 'projekt', label: 'Projekt', type: 'text', required: false, editable: true },
      { key: 'taetigkeit', label: 'Tätigkeit', type: 'text', required: true, editable: true },
      { key: 'stunden', label: 'Stunden', type: 'number', required: true, editable: true },
      { key: 'stundensatz', label: 'Stundensatz', type: 'currency', required: false, editable: true },
    ],
    rows: [],
    calculations: [
      {
        key: 'kosten',
        label: 'Kosten',
        type: 'currency',
        formula: 'stunden * stundensatz',
        displayInTable: true,
        displayInFooter: true
      }
    ]
  };
}

function createMeetingSchema(description) {
  return {
    tableName: 'Aktionsliste',
    description: description || 'Extrahiert Aufgaben und Aktionen aus Meeting-Protokollen',
    columns: [
      { key: 'ticket', label: 'Ticket', type: 'text', required: false, editable: true },
      { key: 'thema', label: 'Thema', type: 'text', required: true, editable: true },
      { key: 'verantwortlich', label: 'Verantwortlich', type: 'text', required: true, editable: true },
      { key: 'faellig', label: 'Fällig am', type: 'date', required: false, editable: true },
      { key: 'prioritaet', label: 'Priorität', type: 'text', required: false, editable: true },
      { key: 'status', label: 'Status', type: 'text', required: false, editable: true },
    ],
    rows: [],
    calculations: []
  };
}

function createContactSchema(description) {
  return {
    tableName: 'Kontaktliste',
    description: description || 'Extrahiert Kontaktdaten aus Text',
    columns: [
      { key: 'firma', label: 'Firma', type: 'text', required: false, editable: true },
      { key: 'name', label: 'Name', type: 'text', required: true, editable: true },
      { key: 'email', label: 'E-Mail', type: 'text', required: false, editable: true },
      { key: 'telefon', label: 'Telefon', type: 'text', required: false, editable: true },
      { key: 'adresse', label: 'Adresse', type: 'text', required: false, editable: true },
      { key: 'notizen', label: 'Notizen', type: 'text', required: false, editable: true },
    ],
    rows: [],
    calculations: []
  };
}

function createGenericSchema(description) {
  return {
    tableName: 'Datentabelle',
    description: description || 'Extrahiert strukturierte Daten aus Text',
    columns: [
      { key: 'spalte_1', label: 'Spalte 1', type: 'text', required: true, editable: true },
      { key: 'spalte_2', label: 'Spalte 2', type: 'text', required: false, editable: true },
      { key: 'spalte_3', label: 'Spalte 3', type: 'text', required: false, editable: true },
    ],
    rows: [],
    calculations: []
  };
}

/**
 * Erzeugt einen Prompt für die KI-Generierung eines Schemas
 */
export function buildTableSchemaGeneratorPrompt(userDescription) {
  return `Du bist ein Datenbank-Designer. Erstelle basierend auf der Beschreibung ein JSON-Schema für eine Datentabelle.

BESCHREIBUNG: "${userDescription}"

Das Schema muss diese Struktur haben:
{
  "tableName": "Name der Tabelle",
  "description": "Kurze Beschreibung",
  "columns": [
    {
      "key": "spalten_key",
      "label": "Anzeigename",
      "type": "text|number|currency|date",
      "required": true,
      "editable": true
    }
  ],
  "rows": [
    {
      "key": "zeilen_key",
      "label": "Anzeigename",
      "required": false,
      "editable": true,
      "hint": "Optionaler Hinweis zur Zeile"
    }
  ],
  "calculations": [
    {
      "key": "berechnung_key",
      "label": "Anzeigename",
      "type": "currency|number",
      "formula": "spalte1 * spalte2",
      "displayInTable": true,
      "displayInFooter": true
    }
  ]
}

REGELN:
- Mindestens 3, maximal 8 Spalten
- Verwende aussagekräftige Keys (nur Kleinbuchstaben, Unterstrich)
- Bei Rechnungen/Bestellungen: Füge Menge × Preis Berechnung hinzu
- Bei Zeitdaten: Stundensatz × Stunden Berechnung
- Keine Formeln für Text-Spalten
- Editable immer true für Benutzer-Änderungen

Gib NUR das JSON zurück, keine Erklärungen.`;
}

/**
 * Parst KI-Antwort zu einem validierten Schema
 */
export function parseGeneratedSchema(aiResponse) {
  try {
    // Extrahiere JSON aus der Antwort
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Kein JSON in der Antwort gefunden');
    }
    
    const schema = JSON.parse(jsonMatch[0]);
    
    // Validiere und ergänze Defaults
    return validateAndNormalizeSchema(schema);
  } catch (error) {
    console.error('Fehler beim Parsen des generierten Schemas:', error);
    return null;
  }
}

function validateAndNormalizeSchema(schema) {
  // Stelle sicher, dass alle erforderlichen Felder vorhanden sind
  if (!schema.tableName) schema.tableName = 'Datentabelle';
  if (!schema.description) schema.description = '';
  if (!Array.isArray(schema.columns)) schema.columns = [];
  if (!Array.isArray(schema.rows)) schema.rows = [];
  if (!Array.isArray(schema.calculations)) schema.calculations = [];
  
  // Normalisiere Spalten
  schema.columns = schema.columns.map((col, idx) => ({
    key: col.key || `spalte_${idx + 1}`,
    label: col.label || `Spalte ${idx + 1}`,
    type: ['text', 'number', 'currency', 'date'].includes(col.type) ? col.type : 'text',
    required: Boolean(col.required),
    editable: col.editable !== false // Default: true
  }));

  // Normalisiere Zeilen
  schema.rows = schema.rows.map((row, idx) => ({
    key: row.key || `zeile_${idx + 1}`,
    label: row.label || `Zeile ${idx + 1}`,
    required: Boolean(row.required),
    editable: row.editable !== false,
    hint: typeof row.hint === 'string' ? row.hint.trim().slice(0, 250) : ''
  }));
  
  // Normalisiere Berechnungen
  schema.calculations = schema.calculations.map((calc, idx) => ({
    key: calc.key || `berechnung_${idx + 1}`,
    label: calc.label || `Berechnung ${idx + 1}`,
    type: ['currency', 'number'].includes(calc.type) ? calc.type : 'number',
    formula: calc.formula || '',
    displayInTable: calc.displayInTable !== false,
    displayInFooter: calc.displayInFooter !== false
  }));
  
  return schema;
}
