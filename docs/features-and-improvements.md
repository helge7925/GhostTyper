# GhostTyper: Features und Verbesserungen

Stand: 2026-02-11

Dieses Dokument beschreibt den aktuellen Funktionsstand inklusive Security-Härtungen, UX-Verbesserungen und Betriebsmaßnahmen.

## 1. Kernfunktionen

### 1.1 Audio-Transkription
- Upload von Audio-Dateien
- Browser-Aufnahme (Desktop und Mobile)
- Voxtral-basierte Transkription
- Diarisierung (Sprecherzuweisung)
- optional automatische Folgeanalyse
- Default-Template im Upload auf `Zusammenfassung` (`generic`) vereinheitlicht

### 1.2 OCR / Document AI
- OCR für PDF und Bilddateien
- Kamera-Workflow für mobile Erfassung
- optional direkte Analyse des OCR-Textes
- Speicherung in der Historie als eigener Datensatz

### 1.3 KI-Analyse
- Analysemodi: `meeting`, `generic`, `aufmass`, Custom-Templates
- Modellauswahl (Large/Medium/Small)
- benutzerdefinierte Zusatzanweisungen (`custom_prompt`)

### 1.4 Übersetzung
- dediziertes Übersetzungsmodul mit Modellauswahl
- OCR-Import in den Übersetzungsfluss
- Weiterbearbeitung im Editor

### 1.5 Editor-zentrierter Workflow
- einheitlicher Document Editor für Ergebnisbearbeitung
- PDF- und DOCX-Export
- PDF-Export über serverseitigen Chromium-Renderer (`/api/export/pdf`) mit Browser-Fallback
- Premium-Layout pro Export per Schalter im Editor aktivierbar/deaktivierbar
- Optionaler PDF-Kopfbereich als reduzierte Signatur mit Titel, Datum und Projekt
- PDF-Ausgabe mit festem UX-Standard:
  - Stil: `Soft Business`
  - Schrift: `Google Sans Soft` (mit Fallbacks)
- PDF öffnet nach Export standardmäßig im Browser-Tab (inline)
- PDF-Export nutzt keinen erzwungenen Download-Fallback mehr
- Speicherung von Editor-Inhalten in Historie
- Fokus auf zentrale Bearbeitung im Editor

## 2. Bedienung und UX

### 2.1 Transparenter Verarbeitungsstatus
- `ProcessStatusCard` als einheitliches Status-UI
- Schrittanzeige pro Prozess
- Restzeitindikator (ETA)
- rotierende Lade-Texte zur Wartezeitüberbrückung
- Live-Updates über SSE (`/api/transcriptions/[id]/stream`) bei laufenden Transkriptionsjobs
- Polling bleibt nur als technischer Fallback
- Startfehler im `pending`-Zustand werden direkt in der Upload-UI angezeigt
- Sofortmaßnahmen im UI: `Erneut starten` (Upload) und `Verarbeitung starten` (Detailseite)

### 2.2 Verlauf pro Auftrag
- Event-Timeline (`Verlauf`) in der Detailansicht
- Ereignisse entlang des gesamten Flows:
  - `queued`
  - `processing`
  - `speaker_assignment`
  - `analyzing`
  - `completed`
  - `error`

### 2.3 Upload-Flow verbessert
- Polling des Auftragsstatus direkt nach Upload
- optionale Auto-Weiterleitung zur Detailseite, sobald Ergebnis bereit ist

### 2.4 Konsistenz
- vergleichbarer Lade-/Status-Ansatz in Upload, OCR, Translate und Text-AI
- Detailseite stärker auf Editor-Nutzung ausgerichtet
- Fokus-Modus im Editor mit reduzierter, ruhiger Oberfläche (`Hell`/`Dunkel`)
- Microcopy auf Kernseiten vereinheitlicht (reduzierter Ton, weniger Superlative)

### 2.5 Browser-Aufnahme verbessert
- Visualizer startet robust nach Aufnahme-Start (kein Timing-Problem mit Canvas-Mount mehr)
- Mikrofon-Signalindikator reagiert sensibler
- Audio-Vorschau startet konsistent am Anfang

## 3. Security-Härtung

### 3.1 API-Key Schutz
- neue verschlüsselte Spalte: `settings.mistral_api_key_encrypted`
- sichere Auflösung von API-Keys über zentrale Service-Layer
- Migrationsskript für Legacy-Klartextwerte

### 3.2 Rate Limiting
- Limits auf sicherheits- und kostenkritischen Routen, u. a.:
  - Auth
  - Upload
  - OCR
  - Text-AI
  - Translate
  - Templates
  - Transcription Detail/Process/Analyze
  - DB-Init

### 3.3 Eingabehärtung
- serverseitige Modell-Whitelist
- stärkere Validierung von Parametern (z. B. Ordnerzuordnung)
- robustere Fehlerausgaben (reduziert sensible Details)

### 3.4 Secrets & Init
- separates `DB_INIT_SECRET` (entkoppelt von `NEXTAUTH_SECRET`)
- DB-Init in Produktion standardmäßig deaktivierbar via `ENABLE_DB_INIT_API`

## 4. Betriebsstabilität

### 4.1 Job-Steuerung
- atomische Statuswechsel für `process` und `analyze`
- Schutz vor Doppelstarts
- hängende Jobs werden als `error` markiert (Stale-Job-Recovery)

### 4.2 Dateiverarbeitung
- Tempfile-Cleanup bei Upload-/OCR-Fehlern
- sichere Dateilöschung nur in erlaubten Upload-Pfaden

### 4.3 Datenbankpflege
- Migrationen über `lib/db-init.js`
- neue Tabelle `transcription_events` + Indizes
- zusätzliche Indizes für häufige Zugriffe

## 5. Daten-/Kontoverwaltung

### 5.1 Historie und Organisation
- Favoriten und Ordner
- Typ-spezifische Darstellung (Transkription, OCR, Übersetzung, Text-AI)

### 5.2 Text-Assistent Aufgaben
- Aufgaben werden dynamisch aus `text_tasks` geladen
- eigene Aufgaben pro Nutzer verwaltbar
- Favoritenpriorisierung

### 5.3 Kostenkontrolle
- Nutzungsprotokoll und Kostenberechnung
- monatliche Kostenlimits

### 5.4 Premium-PDF Profil
- Premium-Headerdaten pro Nutzer in den Einstellungen pflegbar:
  - Unternehmen
  - Name
  - Rolle
  - Kontakt
  - Fußzeile
- Serverseitige Nutzung dieser Daten beim PDF-Render (nicht aus Client-Metadaten)

## 6. Migration und Verifikation

### 6.1 Legacy API-Key Migration
- Dry-Run:
```bash
npm run migrate-api-keys -- --dry-run
```
- Write-Run:
```bash
npm run migrate-api-keys
```

### 6.2 Verifikation (Beispiel mit Docker-DB)
```bash
docker compose -f config/docker-compose.dev.yml exec transkription-db \
  psql -U transkription -d transkription -c "SELECT COUNT(*) AS plaintext_remaining FROM settings WHERE NULLIF(TRIM(mistral_api_key), '') IS NOT NULL;"

docker compose -f config/docker-compose.dev.yml exec transkription-db \
  psql -U transkription -d transkription -c "SELECT COUNT(*) AS encrypted_present FROM settings WHERE NULLIF(TRIM(mistral_api_key_encrypted), '') IS NOT NULL;"
```

## 7. Verweise

- Security-Details: `code-review-hardening-2026-02-11.md`
- Projektplan: `../PROJECT_PLAN.md`
- Einstieg: `../README.md`
