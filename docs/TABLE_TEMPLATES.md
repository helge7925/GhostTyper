# Tabellen-Vorlagen - Technische Dokumentation

Stand: 2026-04-28

## Überblick

Tabellen-Vorlagen ermöglichen die strukturierte Extraktion von Daten aus Audio-Transkriptionen, OCR-Ergebnissen oder Textdateien. Eine Vorlage definiert Metadatenfelder, Spalten und optional feste Zeilentitel. Das KI-Modell füllt ausschließlich Inhalte in diese Struktur ein.

Nicht Teil des aktuellen Tabellen-Vorlagen-Flows sind Berechnungen, Formeln, Summenzeilen oder automatisch abgeleitete Werte. Die Tabellen sollen wie digitale Erfassungsbögen funktionieren.

## Use Cases

| Szenario | Beschreibung | Typische Struktur |
|----------|--------------|-------------------|
| Rechnungen | Positionen aus Rechnungen erfassen | Metadaten: Rechnungsdatum, Lieferant; Spalten: Pos., Artikel, Menge, Preis |
| Inventar | Lagerbestände dokumentieren | Zeilen: feste Lagerplätze; Spalten: Artikel, Bestand, Zustand |
| Zeiterfassung | Stundenzettel aus Diktat füllen | Metadaten: Zeitraum, Person; Spalten: Datum, Projekt, Tätigkeit, Stunden |
| Kontakte | Adressdaten aus Gesprächen erfassen | Spalten: Name, Firma, E-Mail, Telefon |
| Aufmaße | Bau-/Handwerksdaten erfassen | Metadaten: Objekt, Bearbeiter; Zeilen: Räume/Bauteile; Spalten: Länge, Breite, Höhe, Bemerkung |

## Datenbank-Schema

### `templates`

```sql
ALTER TABLE templates
ADD COLUMN template_type VARCHAR(20) DEFAULT 'text'
  CHECK (template_type IN ('text', 'table')),
ADD COLUMN table_schema JSONB DEFAULT NULL;
```

### `transcriptions`

```sql
ALTER TABLE transcriptions
ADD COLUMN analysis_type VARCHAR(20) DEFAULT 'text'
  CHECK (analysis_type IN ('text', 'table')),
ADD COLUMN table_schema JSONB DEFAULT NULL;
```

Tabellen-Ergebnisse werden zusätzlich in `analysis` gespeichert. Bei Tabellen enthält die Analyse mindestens `rows` und optional `metadata`.

## Schema-Struktur

```json
{
  "tableName": "Aufmaß Küche",
  "description": "Erfasst Maße je Wand",
  "metadataFields": [
    {
      "key": "datum",
      "label": "Datum",
      "type": "date",
      "required": false
    },
    {
      "key": "bearbeiter",
      "label": "Bearbeiter",
      "type": "text",
      "required": false
    }
  ],
  "rows": [
    {
      "key": "wand_1",
      "label": "Wand 1"
    },
    {
      "key": "wand_2",
      "label": "Wand 2"
    }
  ],
  "columns": [
    {
      "key": "laenge",
      "label": "Länge",
      "type": "number",
      "required": false,
      "editable": true
    },
    {
      "key": "bemerkung",
      "label": "Bemerkung",
      "type": "text",
      "required": false,
      "editable": true
    }
  ]
}
```

### Feldtypen

| Typ | Beschreibung | Beispiel |
|-----|--------------|----------|
| `text` | Freitext | "Artikel A" |
| `number` | Ganze oder dezimale Zahlen | 10, 5.5 |
| `currency` | Geldbetrag als Wert | 19.99 |
| `date` | Datum | 2026-04-28 |

## KI-Prompt-Regeln

Der Tabellen-Prompt verlangt eine gültige JSON-Antwort mit:
- `metadata`: Werte für definierte Metadatenfelder
- `rows`: Tabellenzeilen mit Zellwerten
- `row_key`: bei festen Zeilentiteln zur eindeutigen Zuordnung
- `zusammenfassung` und Hinweise zu fehlenden Daten

Zentrale Regeln:
- Werte nur aus dem Quelltext ableiten.
- Keine Rechenoperationen durchführen.
- Keine Formeln, Summen oder Aggregationen erzeugen.
- Spalten- und Zeilentitel der Vorlage zur Zuordnung verwenden.
- Fehlende Informationen leer lassen oder als unvollständig melden.

## Komponenten

### `components/TableSchemaBuilder.js`

Excel-artiger Vorlagen-Editor in den Einstellungen.

Funktionen:
- Tabellenname und Beschreibung pflegen
- Metadatenfelder hinzufügen, benennen, typisieren und löschen
- Spalten hinzufügen, benennen, typisieren und löschen
- feste Zeilentitel hinzufügen, benennen und löschen
- Live-Vorschau als Raster
- Schema-Validierung

### `components/TableRenderer.js`

Tabellenanzeige und Inline-Bearbeitung für extrahierte Daten.

Funktionen:
- Metadaten über der Tabelle anzeigen und bearbeiten
- Tabellenzellen bearbeiten
- feste Zeilentitel respektieren
- Zeilen hinzufügen oder entfernen, wenn keine feste Zeilenstruktur definiert ist
- Export nach CSV, Excel und HTML
- Kopieren der Tabelle

### `components/TableEditor.js`

Canvas-artiger Vollbildeditor in der Transkriptionsdetailansicht.

Funktionen:
- Tabelle wie ein Dokument öffnen und nachbearbeiten
- Metadaten und Zellwerte ändern
- Änderungen per `PATCH /api/transcriptions/:id` speichern
- zwischen Tabellenansicht und Quelltext wechseln

## Hilfsfunktionen

### `lib/table-schema.js`

| Funktion | Beschreibung |
|----------|--------------|
| `normalizeTableSchema(schema)` | Normalisiert Metadaten, Zeilen und Spalten |
| `normalizeTableData(data, schema)` | Bringt Analysewerte in die erwartete Tabellenform |
| `createEmptyRowsFromSchema(schema)` | Erzeugt leere Zeilen für feste Zeilentitel |
| `deriveColumnsFromRows(rows)` | Leitet Spalten aus vorhandenen Daten ab |

### `lib/table-calculations.js`

Dieses Modul enthält aus Kompatibilitätsgründen noch ältere Berechnungshelfer. Der aktuelle Tabellen-Vorlagen-Flow nutzt sie nicht für neue Vorlagen. Relevant bleiben:

| Funktion | Beschreibung |
|----------|--------------|
| `validateTableSchema(schema)` | Validiert Tabellen-Schemas inkl. Metadaten |
| `buildTableExtractionPrompt(schema, lang)` | Erzeugt den content-only KI-Prompt |

### `lib/table-export.js`

| Funktion | Beschreibung |
|----------|--------------|
| `exportTableToCSV(tableData, schema, filename)` | Exportiert Metadaten und Tabelle als CSV |
| `exportTableToExcel(tableData, schema, filename)` | Exportiert als formatierte XLSX-Datei |
| `exportTableToHTML(tableData, schema)` | Exportiert als HTML-Tabelle |

Der Excel-Export schreibt Metadaten oberhalb der Tabelle, setzt eine klare Kopfzeile, berücksichtigt feste Zeilentitel, schützt vor Formel-Injection und erzeugt keine Formeln.

## API-Integration

### Tabellen-Vorlage erstellen

```json
POST /api/templates
{
  "name": "Aufmaß Küche",
  "prompt_text": "Fülle die Tabelle anhand des Diktats.",
  "template_type": "table",
  "table_schema": {
    "tableName": "Aufmaß Küche",
    "metadataFields": [
      { "key": "datum", "label": "Datum", "type": "date" }
    ],
    "rows": [
      { "key": "wand_1", "label": "Wand 1" }
    ],
    "columns": [
      { "key": "laenge", "label": "Länge", "type": "number" }
    ]
  }
}
```

Serverseitig wird das Schema normalisiert. Nicht erlaubte Berechnungsfelder werden entfernt.

### Tabellen-Ergebnis speichern

```json
PATCH /api/transcriptions/:id
{
  "tableData": {
    "metadata": {
      "datum": "2026-04-28"
    },
    "rows": [
      {
        "row_key": "wand_1",
        "laenge": 3.2
      }
    ]
  }
}
```

## Workflow

### Vorlage erstellen

```text
Einstellungen -> Verarbeitungstemplates -> Tabellen-Verarbeitung
```

1. Neue Tabellen-Vorlage anlegen.
2. Metadatenfelder definieren.
3. Spaltentitel definieren.
4. Optional feste Zeilentitel definieren.
5. Speichern.

### Verarbeitung

```text
Upload/OCR/Text -> Tabellen-Vorlage auswählen -> Verarbeitung starten
```

1. Quelle wird transkribiert oder per OCR erkannt.
2. KI erhält das Tabellen-Schema.
3. KI füllt Metadaten und Tabellenzellen.
4. Ergebnis wird als Tabellenanalyse gespeichert.

### Nachbearbeitung und Export

1. Transkriptionsdetail öffnen.
2. Tabellen-Canvas öffnen.
3. Metadaten und Zellen korrigieren.
4. Speichern.
5. Als Excel, CSV oder HTML exportieren.

## Fehlerbehandlung

- Fehlende Metadaten bleiben leer.
- Fehlende Zellen bleiben leer.
- Unerwartete Spalten werden nur übernommen, wenn kein Schema vorhanden ist.
- Bei fest definierten Zeilen werden Werte anhand von `row_key` oder Zeilentitel eingeordnet.
- Ungültige Schema-Bestandteile werden serverseitig normalisiert.

## Testing

Automatisierte Tests:

```bash
npm test
```

Aktuell relevant:
- Schema-Validierung
- Prompt-Generierung
- Metadaten im Prompt
- Verbot von Berechnungen im Tabellen-Prompt
- Legacy-Berechnungshelfer als Kompatibilitätstest

Manuelle QA:
- Vorlage mit Metadaten, Zeilen und Spalten erstellen
- Audio-/Text-/OCR-Flow mit Tabellen-Vorlage verarbeiten
- Tabellen-Canvas öffnen und speichern
- Excel-Export prüfen

## Zukünftige Erweiterung

Siehe Konzept: `konzept-automatische-tabellengenerierung-aus-foto.md`.
