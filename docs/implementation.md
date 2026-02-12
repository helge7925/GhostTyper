# Implementierung

Stand: 2026-02-12

Dieses Dokument beschreibt die technische Implementierung des aktuellen GhostTyper-Systems.

## 1. Systemüberblick

GhostTyper ist eine Next.js-Anwendung mit API-Routen als Backend. Die Datenhaltung erfolgt in PostgreSQL, KI-Funktionen werden über die Mistral API aufgerufen.

Kernfluss:
1. Upload/Erfassung (Audio oder Dokument)
2. Verarbeitung (Transkription/OCR)
3. optionale KI-Analyse
4. Bearbeitung im Editor
5. Export oder Speicherung in Historie

## 2. Wichtige Module

### 2.1 Frontend (`pages/`, `components/`)
- `pages/upload.js`: Audio-Upload und Jobstart
- `pages/ocr.js`: OCR-Upload/Kamera und Analysefluss
- `pages/transcriptions/[id].js`: Detailansicht mit Verlauf und Editor-Übergang
- `components/ProcessStatusCard.js`: einheitliche Prozessanzeige (Schritte, ETA, Lade-Texte)
- `components/DocumentEditor.js`: Bearbeitung und Export

### 2.2 Backend (`pages/api/`)
- `upload.js`: Upload, Validierung, Transkriptionsjob anlegen
- `ocr.js`: OCR-Verarbeitung und optional Analyse
- `transcriptions/[id]/process.js`: Queueing und Worker-Start für Transkriptionsjobs
- `transcriptions/[id]/analyze.js`: manuelle Folgeanalyse
- `transcriptions/[id].js`: Detail-GET/PATCH/DELETE inkl. Event-Auslieferung
- `settings.js`: API-Key-Verwaltung, Modell-/Kosten-Einstellungen
- `db-init.js`: Schema-/Migrationsausführung

### 2.3 Shared Libs (`lib/`)
- `ai-service.js`: Aufrufe zu Mistral (Transkription/OCR/Analyse/Translate)
- `db.js`: DB-Zugriff
- `db-init.js`: Schema + Migrationen
- `settings-service.js`: Auflösung gespeicherter API-Keys
- `secrets.js`: Verschlüsselungsfunktionen
- `rate-limit.js`: Ratenbegrenzung
- `model-policy.js`: Modell-Whitelist
- `transcription-events.js`: Event-Logging/Abfrage für Timeline
- `transcription-worker.js`: asynchrone Worker-Verarbeitung für `queued` Jobs
- `observability.js`: strukturierte Logs + Laufzeitmetriken
- `pdf-export.js` + `pdf-print-style.js`: serverseitiger PDF-Renderer inkl. Paginierungsregeln

## 3. Datenmodell (relevante Teile)

### 3.1 `transcriptions`
- Prozessstatus: `pending`, `queued`, `processing`, `transcribed`, `analyzing`, `completed`, `error`
- Inhalt: `text`, `analysis`, `segments`, `speakers`, `document_html`
- Orga: `folder_id`, `is_favorite`

### 3.2 `settings`
- `mistral_api_key` (Legacy)
- `mistral_api_key_encrypted` (aktueller Standard)
- Modell-/Sprachpräferenzen und Kostenlimit

### 3.3 `transcription_events`
- Timeline pro Job (Stage, Message, Timestamp, optional Meta)
- Indizes für schnelle Abfrage pro `transcription_id` und `user_id`

## 4. Verarbeitungslogik

### 4.1 Transkriptionsjob
1. Upload legt Datensatz in `pending` an.
2. `process` setzt atomar auf `queued`.
3. Worker claimed atomar `queued -> processing`.
4. Nach erfolgreicher Transkription:
   - bei Diarisierung: `transcribed` (Warten auf Sprecherzuweisung)
   - ohne Auto-Analyse: `transcribed`
   - mit Auto-Analyse: `analyzing` -> `completed`
5. Fehlerpfad: `error`.

### 4.2 Manuelle Analyse
1. erlaubt nur aus `transcribed`.
2. atomarer Wechsel `transcribed -> analyzing`.
3. Analyseergebnis schreibt `completed` + `analysis`.
4. Fehlerpfad: `error`.

### 4.3 Event-Log
Bei jedem wichtigen Übergang wird ein Event geschrieben (`queued`, `processing`, `analyzing`, `completed`, `error`).
Die Detailansicht rendert diese Events als Verlauf.

### 4.4 Observability
- Strukturierte Logs werden zentral über `lib/observability.js` emittiert.
- Laufzeitmetriken (Worker/DB/Counter) werden im Healthcheck ausgegeben.
- Für Administratoren stehen erweiterte Metriken unter `GET /api/admin/observability` bereit.

## 5. Security-Implementierung

- API-Key-Schutz über verschlüsselte Speicherung.
- Legacy-Migration via `scripts/migrate-api-keys.js`.
- Rate-Limits für sicherheits-/kostenrelevante Endpunkte.
- Modell-Whitelist serverseitig.
- Sicheres Dateilöschen nur im Upload-Verzeichnis.
- DB-Init abgesichert über eigenes Secret und Prod-Toggle.

## 6. UX-Implementierung

- Einheitliche Statuskomponente mit Schritten und ETA.
- Rotierende Lade-Sprüche pro Prozessphase.
- Eigene Warteschlangen-Kommunikation (`queued`) mit dedizierten Hinweisen.
- Optionale Auto-Weiterleitung nach Upload bei fertigem Job.
- Editor mit klaren Primäraktionen (`Speichern`, `PDF exportieren`) und gebündelten Sekundäraktionen (`Mehr`-Menü).
- Konsistente Zustandskommunikation in Upload/OCR/Translate/Text-AI.

## 7. Bekannte technische Grenzen

- `npm run lint` benötigt eine finalisierte ESLint-Konfiguration (sonst interaktiver Prompt).
- In restriktiven Sandboxen kann `next build` bei `Collecting page data` mit `EPERM listen 0.0.0.0` abbrechen.

## 8. Referenzen

- Betriebsanleitung: `../README.md`
- Projektstatus/Roadmap: `../PROJECT_PLAN.md`
- Featureübersicht: `features-and-improvements.md`
- Security-Review: `code-review-hardening-2026-02-11.md`
- Externes Review: `external-review-2026-02-12.md`
- Prioritäten-Protokoll P0-P3: `code-review-priorities-p0-p3-2026-02-12.md`
