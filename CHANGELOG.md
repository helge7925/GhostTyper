# Changelog

Alle relevanten Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Added
- `ProcessStatusCard` als einheitliche Prozesskomponente mit Schrittanzeige, ETA und rotierenden Lade-Texten.
- Event-Timeline pro Transkriptionsjob über `transcription_events` in der Detailansicht.
- Auto-Weiterleitung nach Upload (optional), sobald Ergebnis bereit ist.
- Migrationsskript für Legacy-API-Keys: `npm run migrate-api-keys`.
- Umfassende technische und betriebliche Dokumentation (README, Projektplan, Docs-Konsolidierung).
- Serverseitiger PDF-Export-Endpunkt `POST /api/export/pdf` mit Auth, Rate-Limit und Chromium-Renderpipeline.
- Fester PDF-Standard für konsistente Markenanmutung: `Soft Business` + `Google Sans Soft` (mit Fallbacks).
- PDF-Typografie veredelt: bessere Heading-Hierarchie, weichere Tabellen, akzentuierte Listenmarker, sauberere Leseführung.
- Fokusmodus-Bezeichnungen auf klare UI-Sprache angepasst: `Hell` / `Dunkel`.
- Premium-PDF-Profil in den Einstellungen (`Unternehmen`, `Name`, `Rolle`, `Kontakt`, `Fußzeile`).
- Premium-Layout im PDF-Export pro Vorgang einzeln zuschaltbar (Editor-Schalter).
- SSE-Stream für Live-Status bei Transkriptionsjobs: `GET /api/transcriptions/[id]/stream`.

### Changed
- UI auf reduzierte, Apple-orientierte Interaktion ausgerichtet:
  - erweiterte Optionen in Upload/OCR/Translate/Text-AI als einklappbare Bereiche,
  - Fokus auf primäre Aktionen und geringere visuelle Komplexität.
- Lade-Sprüche in Prozesskarten langsamer rotiert und größer dargestellt (bessere Lesbarkeit).
- Übersetzungslogik stärker auf editor-zentrierten Workflow fokussiert.
- PDF-Export im Editor priorisiert jetzt serverseitiges Rendering mit Browser-Fallback.
- Browser-Fallback für PDF wird nicht mehr still genutzt, sondern als explizite Rückfalloption angeboten.
- PDF-Export öffnet wieder direkt im Browser-Tab (`inline`) statt ausschließlich als Download.
- PDF-Stil/Font-Auswahl aus der Editor-Toolbar entfernt; Export nutzt nun bewusst einen festen Markenstil.
- Standard-Template für Transkriptions-Upload wird konsequent auf `Zusammenfassung` (`generic`) normalisiert.
- PDF-Premium-Kopf wird serverseitig aus Nutzer-Einstellungen befüllt (keine Client-Metadaten als Quelle).
- Upload- und Detailseite nutzen für laufende Jobs primär SSE-Live-Updates statt Client-Polling (Polling bleibt Fallback).
- PDF-Kopfbereich als schlanke Signatur angepasst (Titel, Datum, optional Projekt).
- UI-Microcopy auf Kernseiten weiter beruhigt und vereinheitlicht.

### Fixed
- Robustere Job-Verarbeitung durch atomische Statusübergänge und Schutz vor Doppelstarts.
- Stale-Job-Recovery für hängende `processing`/`analyzing`-Jobs.
- Sichereres Datei-Handling beim Löschen und Upload-Cleanup.
- Browser-Aufnahme: Visualizer-Start robust gegen Render-Timing (Wellenanzeige/Mikrofonsignal).
- Browser-Aufnahme: Audio-Vorschau startet konsistent am Anfang statt mit falscher Fortschrittsposition.
- Chromium-PDF-Header/Footer-Artefakte (z. B. `file:///tmp/...`, Datum/Uhrzeit) entfernt.
- Upload-/Queue-Startfehler sind nicht mehr „still“: klare UI-Meldung + manuelle Neustart-Aktion.
- PDF-Export erzwingt keinen Datei-Download mehr; Öffnung erfolgt ausschließlich im Browser-Tab.

### Security
- Verschlüsselte API-Key-Speicherung (`settings.mistral_api_key_encrypted`).
- Rate-Limits auf kritischen API-Endpunkten.
- Modell-Whitelist serverseitig.
- Getrennte Secrets für Auth und DB-Init (`NEXTAUTH_SECRET`, `DB_INIT_SECRET`).
