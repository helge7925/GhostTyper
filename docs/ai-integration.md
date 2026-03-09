# AI-Integration Dokumentation

## Übersicht

Dieses Dokument beschreibt die AI-Integration für die GhostTyper WebApp.
- Mistral-Modelle: Transkription, OCR, Analyse, Übersetzung
- Gemini-Modell: Sketch Summary Bildgenerierung (`/sketch`)

## Architektur

### AI-Integration-Fluss

1. **Audio-Verarbeitung**: Audio-Aufnahmen werden serverseitig via FFmpeg in MP3 konvertiert, um maximale Kompatibilität mit der Mistral API zu gewährleisten.
2. **Transkription**: Die Audio-Datei wird mit Mistral Voxtral Mini (`voxtral-mini-latest`) transkribiert.
3. **Analyse**: Das Transkript wird basierend auf Vorlagen mit Mistral Large, Medium oder Small analysiert.
4. **OCR**: Dokumente (PDF/Bilder) werden mit Mistral OCR (`mistral-ocr-latest`) verarbeitet.
5. **Übersetzung**: Texte werden mit Mistral-Modellen in die gewählte Zielsprache übersetzt.
6. **Sketch Summary**: Lerntext wird an Gemini (`gemini-3-pro-image-preview`) gesendet, das Modell liefert eine Bildantwort (inlineData/Base64).
7. **Speichern**: Alle Ergebnisse werden strukturiert in der PostgreSQL-Datenbank gespeichert.

## Konfiguration

### Mistral-API

Die Mistral-API-Logik ist zentral in `lib/ai-service.js` implementiert.

**Transkription:**
Nutzt den `/audio/transcriptions` Endpoint. Unterstützt Diarization (Sprechererkennung) und Context Bias (Fachbegriffe).

**Analyse & Chat:**
Nutzt den `/chat/completions` Endpoint mit JSON-Response-Format für strukturierte Analysen.

### Gemini-API (Sketch Summary)

- Endpoint: `POST /api/sketch-summary`
- SDK: `@google/genai`
- Modell: `gemini-3-pro-image-preview`
- Response-Modality: `TEXT` + `IMAGE` (genutzte Ausgabe: `IMAGE` via `inlineData`)
- Bildkonfiguration:
  - `aspectRatio: "3:4"`
  - `imageSize: "2K"`
- Sicherheits-/Betriebslogik:
  - Sessionpflicht (NextAuth) + Rate-Limit (`20`/Minute pro User)
  - Kosten-Guardrail (`checkCostLimit` + `withUserCostLock`)
  - Usage-Logging (`logUsage`) mit normalisierten Tokenwerten
  - PNG-Enforcement (`image/png`) vor API-Response

### Sketch Summary: Key-Auflösung und Fehlerverhalten

- API-Key-Auflösung:
  1. User-Settings (`google_api_key_encrypted`/`google_api_key`)
  2. Fallback `GEMINI_API_KEY` aus `.env`
- Fehler-Mapping:
  - ungültiger/unerlaubter API-Key -> `400`
  - Provider-Quota/Rate-Limit -> `429`
  - Kostenlimit erreicht -> `429`
  - temporär nicht verfügbare Kostenprüfung -> `503`
  - fehlendes Bild oder Nicht-PNG vom Modell -> `502`

### Unterstützte Modelle
- **Transkription**: `voxtral-mini-latest` (Voxtral Mini)
- **Analyse**: `mistral-large-latest`, `mistral-medium-latest`, `mistral-small-latest`
- **OCR**: `mistral-ocr-latest`
- **Übersetzung**: Wählbar (Standard: `mistral-medium-latest`)
- **Sketch Summary**: `gemini-3-pro-image-preview`

## Umgebung

Die Umgebung wird über die `.env`-Datei konfiguriert:

- **MISTRAL_API_KEY**: Ihr persönlicher Mistral API-Schlüssel.
- **GEMINI_API_KEY**: Fallback für Sketch Summary, falls kein Google-Key in den User-Einstellungen gespeichert ist.
- **DATABASE_URL**: Verbindung zur PostgreSQL-Datenbank.
