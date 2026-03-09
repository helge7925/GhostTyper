# Tabellen-Vorlagen - Technische Dokumentation

Version: 1.1.0

---

## Überblick

Tabellen-Vorlagen ermöglichen die strukturierte Extraktion von Daten aus Audio-Transkriptionen, OCR-Ergebnissen oder Text-Dateien. Anstatt einer freien Textanalyse liefert die KI ein definiertes JSON-Schema, das als interaktive Tabelle dargestellt wird.

---

## Use Cases

| Szenario | Beschreibung | Beispiel-Spalten |
|----------|-------------|------------------|
| **Rechnungen** | Extraktion von Rechnungspositionen | Pos., Artikel, Menge, Preis, Gesamt |
| **Inventar** | Lagerbestands-Erfassung | Artikel-Nr., Bezeichnung, Bestand, Lagerort |
| **Zeiterfassung** | Stundenzettel aus Diktat | Datum, Projekt, Tätigkeit, Stunden, Kosten |
| **Kontakte** | Adressen aus Gesprächen | Name, Firma, E-Mail, Telefon |
| **Aufmaße** | Bau-/Handwerks-Aufmaße | Raum, Element, Breite, Höhe, Fläche |

---

## Datenbank-Schema

### Erweiterung der `templates` Tabelle

```sql
ALTER TABLE templates 
ADD COLUMN template_type VARCHAR(20) DEFAULT 'text' 
  CHECK (template_type IN ('text', 'table')),
ADD COLUMN table_schema JSONB DEFAULT NULL;

CREATE INDEX idx_templates_type ON templates(template_type);
```

### Erweiterung der `transcriptions` Tabelle

```sql
ALTER TABLE transcriptions 
ADD COLUMN analysis_type VARCHAR(20) DEFAULT 'text'
  CHECK (analysis_type IN ('text', 'table')),
ADD COLUMN table_schema JSONB DEFAULT NULL;
```

---

## JSON Schema-Struktur

### Beispiel: Rechnungsvorlage

```json
{
  "tableName": "Rechnungspositionen",
  "description": "Extrahiert Positionen aus Rechnungen",
  "columns": [
    {
      "key": "pos",
      "label": "Pos.",
      "type": "number",
      "required": true,
      "editable": true
    },
    {
      "key": "artikel",
      "label": "Artikel / Leistung",
      "type": "text",
      "required": true,
      "editable": true
    },
    {
      "key": "menge",
      "label": "Menge",
      "type": "number",
      "required": true,
      "editable": true
    },
    {
      "key": "einzelpreis",
      "label": "Einzelpreis",
      "type": "currency",
      "required": true,
      "editable": true
    }
  ],
  "calculations": [
    {
      "key": "gesamt",
      "label": "Gesamt",
      "type": "currency",
      "formula": "menge * einzelpreis",
      "displayInTable": true,
      "displayInFooter": true
    }
  ]
}
```

### Feld-Typen

| Typ | Beschreibung | Beispiel | Formatierung |
|-----|-------------|----------|--------------|
| `text` | Freitext | "Artikel A" | - |
| `number` | Ganze/Dezimalzahlen | 10, 5.5 | Tausender-Trennzeichen |
| `currency` | Währungsbeträge | 19.99 | 2 Dezimalstellen + € |
| `date` | Datum | 2025-02-18 | DD.MM.YYYY |

### Berechnungs-Formeln

Unterstützte Operatoren:
- `+` Addition
- `-` Subtraktion
- `*` Multiplikation
- `/` Division
- `()` Klammern
- `sum(spalte)` Aggregation

Beispiele:
```
gesamt = menge * preis
rabatt_preis = preis * (1 - rabatt / 100)
gesamtgewicht = sum(einzelgewicht)
```

---

## KI-Prompt Generierung

### Template für Tabellen-Extraktion

```
Du bist ein Experte für Datenextraktion. Extrahiere alle relevanten 
Informationen aus dem folgenden Text und erstelle eine strukturierte Tabelle.

TABELLE: {tableName}

SPALTEN:
- "pos": "Pos." (number, erforderlich)
- "artikel": "Artikel / Leistung" (text, erforderlich)
- "menge": "Menge" (number, erforderlich)
- "einzelpreis": "Einzelpreis" (currency, erforderlich)

WICHTIGE REGELN:
- Gib das Ergebnis als gültiges JSON zurück
- Die Hauptdaten sind im Array "rows"
- Bei Zahlen: Punkt als Dezimaltrenner
- Bei Währungen: Nur Zahlenwert, kein €-Zeichen
- Bei Datum: ISO-Format YYYY-MM-DD

ERFORDERLICHE JSON-STRUKTUR:
{
  "rows": [
    {
      "pos": 1,
      "artikel": "Beispiel Artikel",
      "menge": 5,
      "einzelpreis": 10.00
    }
  ],
  "extrahierte_zeilen_anzahl": 1,
  "unvollstaendige_daten": [],
  "zusammenfassung": "Kurze Zusammenfassung"
}

TEXT ZUR ANALYSE:
"{TEXT}"
```

---

## Komponenten

### TableSchemaBuilder

**Pfad**: `components/TableSchemaBuilder.js`

**Funktionen**:
- Schnellstart-Presets (z.B. Rechnung, Zeiterfassung, Aktionsliste)
- Spalten visuell als Tabellenaufbau bearbeiten
- Reihenfolge per Links/Rechts-Steuerung
- Datentyp, Pflichtfeld und Editierbarkeit je Spalte
- Berechnungen mit Formelhilfe und Vorschau
- Schema-Validierung + Live-Vorschau

**Props**:
```javascript
{
  schema: TableSchema,        // Aktuelles Schema
  onChange: (schema) => void  // Callback bei Änderungen
}
```

### TableRenderer

**Pfad**: `components/TableRenderer.js`

**Funktionen**:
- Tabellarische Datenanzeige
- Inline-Editing
- Berechnete Felder aktualisieren
- Zeilen hinzufügen/entfernen
- Export (CSV, Excel, Kopieren)

**Props**:
```javascript
{
  initialData: {
    rows: Array<Object>,
    footerStats?: Object
  },
  schema: TableSchema,
  filename: string,
  onChange?: (rows) => void
}
```

---

## Hilfsfunktionen

### table-calculations.js

| Funktion | Beschreibung |
|----------|-------------|
| `evaluateFormula(formula, rowData)` | Berechnet eine Formel |
| `applyCalculations(row, calculations)` | Wendet alle Berechnungen auf eine Zeile an |
| `calculateFooterStats(rows, columns, calculations)` | Berechnet Summen für Fußzeile |
| `validateTableSchema(schema)` | Validiert ein Schema |
| `buildTableExtractionPrompt(schema, lang)` | Erzeugt KI-Prompt |

### table-export.js

| Funktion | Beschreibung |
|----------|-------------|
| `exportTableToCSV(tableData, schema, filename)` | Exportiert als CSV |
| `exportTableToExcel(tableData, schema, filename)` | Exportiert als XLSX |
| `exportTableToHTML(tableData, schema)` | Exportiert als HTML-Tabelle |

### table-template-generator.js

| Funktion | Beschreibung |
|----------|-------------|
| `generateSchemaFromDescription(description)` | Generiert Schema aus Text |
| `buildTableSchemaGeneratorPrompt(description)` | Erzeugt KI-Prompt für Schema-Generierung |
| `parseGeneratedSchema(aiResponse)` | Parst KI-Antwort zu Schema |

---

## API Integration

### Templates API

**Erstellen einer Tabellen-Vorlage**:
```javascript
POST /api/templates
{
  "name": "Rechnungspositionen",
  "prompt_text": "...",
  "template_type": "table",
  "table_schema": {
    "tableName": "Rechnungspositionen",
    "columns": [...],
    "calculations": [...]
  }
}
```

### Analyse-Flow

**Analyse mit Tabellen-Vorlage**:
1. Benutzer wählt Tabellen-Vorlage
2. System erkennt `template_type === 'table'`
3. `buildTableExtractionPrompt()` generiert Prompt
4. KI liefert JSON mit `rows` Array
5. System speichert mit `analysis_type: 'table'`
6. Frontend rendert `TableRenderer`

---

## Workflow

### 1. Vorlage erstellen

```
Settings → Verarbeitungstemplates → Tabellen-Verarbeitung
→ "+ Neue Tabellen-Vorlage"
```

**Schritte**:
1. Name eingeben
2. Spalten definieren (Key, Label, Typ)
3. Optional: Berechnungen hinzufügen
4. Speichern

### 2. Transkription

```
Upload → Tabellen-Vorlage auswählen → Verarbeitung starten
```

**Ablauf**:
1. Audio wird transkribiert
2. KI extrahiert strukturierte Daten
3. Berechnungen werden durchgeführt
4. Ergebnis wird als Tabelle angezeigt

### 3. Bearbeitung

**Möglichkeiten**:
- Einzelne Zellen editieren
- Zeilen hinzufügen/entfernen
- Berechnungen werden automatisch aktualisiert
- Export nach CSV/Excel

---

## Fehlerbehandlung

### Schema-Validierung

```javascript
const validation = validateTableSchema(schema);
if (!validation.isValid) {
  // validation.errors enthält Fehlerliste
  // z.B. "Spalten-Keys müssen eindeutig sein"
}
```

### KI-Extraktion

**Falls KI kein valides JSON liefert**:
- Fallback auf leere Tabelle
- Fehler wird geloggt
- Benutzer kann manuell editieren

**Falls Spalten fehlen**:
- Fehlende Spalten werden mit leeren Werten aufgefüllt
- Validierung zeigt unvollständige Daten an

---

## Performance

### Optimierungen

- **Berechnungen**: Client-seitig via `useMemo`
- **Export**: Lazy loading der `xlsx` Bibliothek
- **Editing**: Lokaler State, optionaler Auto-Save

### Limits

- Max. 20 Spalten pro Tabelle
- Max. 1000 Zeilen für Export
- Formel-Komplexität: Max. 5 Operatoren

---

## Testing

### Manuelle Tests

1. **Schema-Editor**:
   - Spalten hinzufügen/entfernen
   - Reihenfolge ändern
   - Berechnungen definieren

2. **KI-Extraktion**:
   - Verschiedene Audio-Dateien
   - Unterschiedliche Vorlagen
   - Edge Cases (leere Daten)

3. **Export**:
   - CSV mit Sonderzeichen
   - Excel mit Formatierung
   - HTML mit Styling

### Automatisierte Tests

```javascript
// Beispiel: Formel-Berechnung
test('evaluateFormula', () => {
  expect(evaluateFormula('menge * preis', { menge: 2, preis: 10 })).toBe(20);
});

// Beispiel: Schema-Validierung
test('validateTableSchema', () => {
  const invalidSchema = { tableName: '', columns: [] };
  expect(validateTableSchema(invalidSchema).isValid).toBe(false);
});
```

---

## Zukünftige Erweiterungen

### Geplant

- [ ] **Bedingte Formatierung**: Zellen einfärben basierend auf Werten
- [ ] **Validierungsregeln**: Min/Max Werte, Pflichtfelder
- [ ] **Beziehungen**: Referenzen zwischen Tabellen
- [ ] **Templates teilen**: Import/Export von Vorlagen
- [ ] **Bulk-Import**: Mehrere Dateien gleichzeitig verarbeiten

### Ideen

- Pivot-Tabellen
- Diagramme/Charts
- API-Webhooks für externe Integrationen
- Kollaboratives Editing

---

## Referenzen

- **Code**: `lib/table-calculations.js`, `lib/table-export.js`
- **Komponenten**: `components/TableSchemaBuilder.js`, `components/TableRenderer.js`
- **API**: `pages/api/templates/index.js`, `pages/api/templates/[id].js`
- **Changelog**: `CHANGELOG.md`
