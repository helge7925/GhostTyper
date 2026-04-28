# AI-Integration Dokumentation

## Übersicht

Dieses Dokument beschreibt die AI-Integration für die GhostTyper WebApp.
- Mistral-Modelle: Transkription, OCR, Analyse, Übersetzung

## Architektur

### AI-Integration-Fluss

1. **Audio-Verarbeitung**: Audio-Aufnahmen werden serverseitig via FFmpeg in MP3 konvertiert, um maximale Kompatibilität mit der Mistral API zu gewährleisten.
2. **Transkription**: Die Audio-Datei wird mit Mistral Voxtral Mini (`voxtral-mini-latest`) transkribiert.
3. **Analyse**: Das Transkript wird basierend auf Vorlagen mit Mistral Large, Medium oder Small analysiert.
4. **OCR**: Dokumente (PDF/Bilder) werden mit Mistral OCR (`mistral-ocr-latest`) verarbeitet.
5. **Übersetzung**: Texte werden mit Mistral-Modellen in die gewählte Zielsprache übersetzt.
6. **Speichern**: Alle Ergebnisse werden strukturiert in der PostgreSQL-Datenbank gespeichert.

## Konfiguration

### Mistral-API

Die Mistral-API-Logik ist zentral in `lib/ai-service.js` implementiert.

**Transkription:**
Nutzt den `/audio/transcriptions` Endpoint. Unterstützt Diarization (Sprechererkennung) und Context Bias (Fachbegriffe).

**Analyse & Chat:**
Nutzt den `/chat/completions` Endpoint mit JSON-Response-Format für strukturierte Analysen.

### Unterstützte Modelle
- **Transkription**: `voxtral-mini-latest` (Voxtral Mini)
- **Analyse**: `mistral-large-latest`, `mistral-medium-latest`, `mistral-small-latest`
- **OCR**: `mistral-ocr-latest`
- **Übersetzung**: Wählbar (Standard: `mistral-medium-latest`)
- **Sketch Summary**: `gemini-3-pro-image-preview`

## Umgebung

Die Umgebung wird über die `.env`-Datei konfiguriert:

- **MISTRAL_API_KEY**: Ihr persönlicher Mistral API-Schlüssel.
- **DATABASE_URL**: Verbindung zur PostgreSQL-Datenbank.
