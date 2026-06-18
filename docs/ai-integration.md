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
