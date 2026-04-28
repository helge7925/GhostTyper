# Konzept: Automatische Tabellengenerierung aus Foto

Stand: 2026-04-28

## Zielbild

GhostTyper soll aus einem Foto, Scan oder PDF einer bestehenden Papiertabelle automatisch eine wiederverwendbare Tabellen-Vorlage erzeugen. Die Vorlage besteht aus frei benennbaren Metadatenfeldern, Spaltentiteln und optionalen Zeilentiteln. Nach der Erzeugung landet sie direkt im Excel-artigen Vorlagen-Editor, damit Nutzer die Erkennung prüfen, korrigieren und speichern können.

Wichtig: Die Vorlage beschreibt ausschließlich Inhalte. Das KI-Modell soll keine Berechnungen, Summen, Formeln oder Ableitungen erzeugen.

## Nutzen

- Vorlagen müssen nicht mehr manuell aus Papierformularen nachgebaut werden.
- Bestehende Arbeitsblätter, Checklisten, Aufmaßbögen oder Erfassungsformulare können schneller digitalisiert werden.
- Die gleiche Struktur kann anschließend für Diktat, OCR und Textverarbeitung genutzt werden.
- Metadaten wie Datum, Name, Projekt, Objekt oder Bearbeiter werden getrennt von der eigentlichen Tabelle erfasst und exportiert.

## Nutzerfluss

1. In den Einstellungen öffnet der Nutzer `Verarbeitungstemplates`.
2. Bei Tabellen-Vorlagen gibt es die Aktion `Vorlage aus Foto erstellen`.
3. Der Nutzer lädt ein Foto, einen Scan oder ein PDF hoch.
4. GhostTyper führt OCR aus und übergibt den erkannten Text mit Layout-Hinweisen an das KI-Modell.
5. Das Modell erzeugt einen Vorschlag mit:
   - Tabellenname
   - Beschreibung
   - Metadatenfeldern
   - Spalten
   - Zeilentiteln
6. Der Vorschlag wird im Tabellen-Vorlagen-Editor angezeigt.
7. Der Nutzer prüft und korrigiert die Struktur.
8. Erst nach Bestätigung wird die Vorlage gespeichert.

## MVP-Funktionsumfang

- Upload von Bilddateien und PDFs im bestehenden OCR-Flow.
- OCR-basierte Extraktion des Tabelleninhalts.
- KI-gestützte Ableitung eines Tabellen-Schemas.
- Erkennung von Metadatenfeldern oberhalb oder neben der Tabelle.
- Erkennung von Spaltentiteln.
- Erkennung von Zeilentiteln, wenn die Vorlage klar zeilenorientiert ist.
- Übergabe an den bestehenden Excel-artigen Tabellen-Editor.
- Speichern als normale Tabellen-Vorlage.
- Keine automatische Aktivierung ohne Nutzerprüfung.

## Datenmodell

Die Ausgabe soll dem bestehenden Tabellen-Schema entsprechen:

```json
{
  "tableName": "Aufmaß Küche",
  "description": "Aus Papierformular erkannt",
  "metadataFields": [
    { "key": "datum", "label": "Datum", "type": "date", "required": false },
    { "key": "bearbeiter", "label": "Bearbeiter", "type": "text", "required": false }
  ],
  "columns": [
    { "key": "laenge", "label": "Länge", "type": "number", "required": false },
    { "key": "breite", "label": "Breite", "type": "number", "required": false }
  ],
  "rows": [
    { "key": "wand_1", "label": "Wand 1" },
    { "key": "wand_2", "label": "Wand 2" }
  ]
}
```

Nicht erlaubt:
- `calculations`
- Formeln
- Summenzeilen
- automatisch berechnete Werte

## Technischer Ansatz

### 1. Upload und OCR

Der bestehende OCR-Stack kann als Einstieg genutzt werden. Für das MVP reicht es, die Datei über eine neue API-Route oder eine Erweiterung des Template-Flows an Mistral OCR zu senden und den erkannten Text strukturiert weiterzugeben.

Empfohlene Route:

```text
POST /api/templates/from-image
```

Request:
- `multipart/form-data`
- Datei: Bild oder PDF
- optionaler Name/Vorlagenhinweis

Response:
- normalisiertes Tabellen-Schema
- OCR-Zusammenfassung
- Warnungen, falls die Struktur unsicher erkannt wurde

### 2. Schema-Erkennung

Das KI-Modell erhält:
- OCR-Text
- erkannte Layout-Reihenfolge
- klare Systemregel: nur Metadaten, Spalten und Zeilen erkennen
- Verbot von Berechnungen und Ergebniswerten

Die KI soll leere Vorlagenstruktur erzeugen, nicht die Tabelle mit Beispielwerten befüllen.

### 3. Normalisierung und Validierung

Serverseitig wird das Ergebnis mit der bestehenden Schema-Normalisierung geprüft:
- eindeutige Keys
- sinnvolle Fallback-Namen
- mindestens eine Spalte
- maximal sinnvolle Spalten-/Zeilenanzahl
- Entfernen unbekannter oder nicht erlaubter Felder
- Entfernen von Berechnungen

### 4. Editor-Übergabe

Der Vorschlag wird nicht direkt persistiert, sondern im vorhandenen `TableSchemaBuilder` angezeigt. Nutzer können Metadaten, Zeilentitel und Spaltentitel dort korrigieren.

## Qualität und Fehlerfälle

- Unsichere Erkennung wird mit Warnungen markiert.
- Wenn keine klare Tabelle gefunden wird, wird keine Vorlage gespeichert.
- Wenn Metadaten und Tabellenkopf verwechselt werden könnten, soll der Editor die Felder trotzdem bearbeitbar anzeigen.
- Bei mehrseitigen PDFs wird im MVP die erste klar erkannte Tabelle priorisiert.
- Handschriftliche Fotos sind möglich, aber deutlich fehleranfälliger als gedruckte Tabellen.

## Aufwandsschätzung

### MVP: ca. 0,5 bis 1 Tag

Geeignet für:
- saubere Fotos oder PDFs
- einfache Tabellen mit klaren Kopfzeilen
- manuelle Prüfung im Editor

Umfang:
- Upload-Aktion in den Einstellungen
- neue API-Route
- OCR-Aufruf
- KI-Prompt für Schema-Erkennung
- Übergabe an den bestehenden Tabellen-Editor

### Produktiv nutzbar: ca. 1,5 bis 3 Tage

Zusätzlich:
- bessere Fehlerhinweise
- Preview der erkannten OCR-Struktur
- zuverlässigere Metadaten-Erkennung
- Tests für Schema-Normalisierung
- Beispielbilder in der manuellen QA

### Robust für schwierige Vorlagen: ca. 4 bis 7 Tage

Zusätzlich:
- Mehrseiten-Erkennung
- Tabellenbereich-Auswahl
- Umgang mit gedrehten oder schief fotografierten Vorlagen
- Vergleich mehrerer KI-Vorschläge
- visuelle Hervorhebung erkannter Bereiche

## Akzeptanzkriterien

- Aus einem einfachen Foto wird eine Tabellen-Vorlage mit Spalten erkannt.
- Metadaten über der Tabelle werden als separate Felder vorgeschlagen.
- Zeilentitel werden erkannt, wenn die Tabelle feste Zeilen besitzt.
- Die Vorlage wird vor dem Speichern im Tabellen-Editor angezeigt.
- Der gespeicherte Vorschlag enthält keine Berechnungen.
- Die Vorlage funktioniert anschließend im normalen Transkriptions- und OCR-Flow.
- Der Excel-Export bleibt sauber: Metadaten oben, Tabelle darunter, keine Formeln.

## Offene Fragen

- Sollen Nutzer vor der Erkennung einen Tabellenbereich im Bild markieren können?
- Sollen mehrere Tabellen aus einem Foto erkannt oder zunächst nur eine Tabelle unterstützt werden?
- Sind handschriftliche Formulare ein Muss für die erste Version oder reicht gedrucktes Material?
- Soll die erkannte OCR-Rohfassung dauerhaft gespeichert oder nur zur Vorlagenerstellung verwendet werden?
