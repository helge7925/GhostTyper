# AI-Integration Dokumentation

## Übersicht

Dieses Dokument beschreibt die AI-Integration für die GhostTyper WebApp.
- Cortecs-Modelle: Transkription, Analyse, Übersetzung, Textoptimierung
- Mistral-Modelle: OCR und Voxtral-TTS

## Architektur

### AI-Integration-Fluss

1. **Audio-Verarbeitung**: Audio-Aufnahmen werden serverseitig via FFmpeg in MP3 konvertiert, um maximale Kompatibilität mit STT-APIs zu gewährleisten.
2. **Transkription**: Die Audio-Datei wird standardmäßig über Cortecs mit `whisper-large-v3` transkribiert.
3. **Analyse**: Das Transkript wird basierend auf Vorlagen über Cortecs mit `deepseek-v4-pro` analysiert.
4. **OCR**: Dokumente (PDF/Bilder) werden mit Mistral OCR (`mistral-ocr-latest`) verarbeitet.
5. **Übersetzung**: Texte werden über Cortecs in die gewählte Zielsprache übersetzt.
6. **Speichern**: Alle Ergebnisse werden strukturiert in der PostgreSQL-Datenbank gespeichert.

## PDF-Übersetzung: digital vs. Scan

Die Datei-Übersetzung (`pages/api/translate/file.js`) wählt für PDFs den Pfad
anhand des eingebetteten Text-Layers (`lib/pdf-inplace.js`,
`detectTextLayer`):

- **Digitale PDFs** (eingebetteter Text, lateinische Zielsprache) werden
  **layouterhaltend in-place** übersetzt. Positionierte Text-Runs werden mit
  `pdfjs-dist` (Legacy-Node-Build ohne Worker) extrahiert, in Absätze
  segmentiert (Spalten-/Lese-Reihenfolge-Heuristik), segmentweise über
  dieselbe Glossar-/TM-Maschinerie wie der Office-Pfad übersetzt und mit
  `pdf-lib` über das Originallayout gezeichnet (White-Out der Original-Runs +
  Redraw). Antwort-Header: `X-GhostTyper-PDF-Layout-Mode: in-place`.
- **Scans / PDFs ohne Text-Layer**, **nicht-lateinische Zielsprachen** und
  **nicht-WinAnsi-kodierbare Zieltexte** fallen auf den bestehenden
  OCR→Markdown→HTML→PDF-Pfad (`mistral-ocr-latest` + Chromium-Renderer)
  zurück. Antwort-Header: `X-GhostTyper-PDF-Layout-Mode: approximated`.

**Layout-Report.** Beide Pfade liefern einen URI-kodierten JSON-Report im
Header `X-GhostTyper-Layout`:
`{ pages, segments, translated, overflows, fontFallbacks, nonEncodable, mode }`
(der Fallback-Pfad ergänzt `reason`). Er wird auch in der History/Audit-Zeile
protokolliert, damit nachvollziehbar ist, was verändert wurde.

**Phase-1-Scope.** Lateinische Zielschrift; Ersatzschriften sind pdf-lib
StandardFonts (Helvetica/Times/Courier, WinAnsi-Kodierung inkl. ä/ö/ü/ß/€).
Überlauf-Strategie: Schriftgröße bis −20 % verkleinern, dann Umbruch innerhalb
der Absatz-Bbox; nie stilles Abschneiden — Überläufe werden gezählt.
Nicht-kodierbare Zeichen führen zum OCR-Fallback statt zu `?`-Ersetzung. Der
Original-Text bleibt unter dem White-Out im Stream erhalten (Vertraulichkeits-
Hinweis; das Entfernen der Original-Objekte ist Phase 2). CJK/RTL, Font-
Matching/-Embedding und AcroForm-Felder sind ebenfalls Phase 2.

## Konfiguration

### Cortecs-API

Die Cortecs-API-Logik für Chat/STT ist zentral in `lib/ai-service.js` implementiert. Mistral-spezifische OCR bleibt im selben Modul isoliert.

**Transkription:**
Nutzt den Cortecs `/audio/transcriptions` Endpoint. Workspace-Kontextbegriffe werden als OpenAI-kompatibles `prompt` übergeben.

**Analyse & Chat:**
Nutzt den Cortecs `/chat/completions` Endpoint mit JSON-Response-Format für strukturierte Analysen.

### Unterstützte Modelle
- **Batch-Transkription** (Datei-Upload): `whisper-large-v3`
- **Live-Transkription** (Vexa-Pfad): `whisper-large-v3` über die interne Bridge
- **Analyse / Chat**: `deepseek-v4-pro`
- **OCR**: `mistral-ocr-latest`
- **Übersetzung/Textoptimierung**: `deepseek-v4-pro`, wählbar pro Workspace

## Umgebung

Die Umgebung wird über die `.env`-Datei konfiguriert:

- **CORTECS_API_KEY**: API-Schlüssel für Transkription, Analyse, Übersetzung und Textoptimierung.
- **MISTRAL_API_KEY**: Mistral API-Schlüssel für OCR und TTS.
- **DATABASE_URL**: Verbindung zur PostgreSQL-Datenbank.
