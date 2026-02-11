# GhostTyper Code Review & Hardening Report

Datum: 2026-02-11
Scope: gesamtes Repository (API, Auth, Upload/OCR, DB, Admin, Frontend-Runtime)

## 1) Ziel und Vorgehen

Diese Review hatte drei Ziele:

1. Sicherheitslücken identifizieren und schließen.
2. Betriebsrisiken im Live-Betrieb reduzieren.
3. Laufzeitfehler ohne Funktionsverlust beheben.

Methodik:

- Prüfung aller API-Routen in `pages/api/**`.
- Prüfung zentraler Libs in `lib/**`.
- Prüfung wichtiger UI-Flows (`upload`, `ocr`, `transcriptions`, `settings`, `admin`).
- Build-Check (`npm run build`) als Kompilierungs-Validierung.

## 2) Ursprüngliche Hauptrisiken

### Security

- `db-init` mit `NEXTAUTH_SECRET` gekoppelt (ein Secret für zwei Sicherheitsdomänen).
- Keine serverseitigen Rate-Limits auf Login/AI/OCR/Upload-Endpunkten.
- API-Keys im Klartext in DB (`settings.mistral_api_key`).
- Zu detaillierte Logs (Auth- und DB-Kontext).
- Fehlende Modell-Whitelist für clientseitig übergebene Modelle.
- Folder-Zuordnung ohne Ownership-Validierung.

### Betrieb/Stabilität

- Race-Conditions bei `process`/`analyze` (Doppelstarts möglich).
- Temporäre Upload-Dateien wurden bei Validierungsfehlern nicht immer aufgeräumt.
- Hintergrundjobs können bei Prozessabbruch in Zwischenstatus hängen bleiben.
- Mehrere Einzel-Updates pro PATCH in Transcription-API (unnötige DB-Roundtrips).

### Laufzeit/Qualität

- Fehlender Import `deleteTranscription` in Historie-Seite.
- Null-unsafe Suche (`original_name.toLowerCase()`).
- Inkonsistente Passwortvalidierung (Admin-Update nur Mindestlänge).
- README verweist auf nicht mehr existierenden Endpoint (`/api/admin/seed`).

## 3) Umgesetzte Maßnahmen

## 3.1 Neue Security- und Service-Layer

Neu hinzugefügt:

- `lib/rate-limit.js`
  - In-Memory Rate-Limiter mit konfigurierbaren Fenstern und Limits.
  - Standardisierte Response-Header (`X-RateLimit-*`, `Retry-After`).
- `lib/secrets.js`
  - AES-256-GCM Verschlüsselung/Entschlüsselung für sensitive Secrets.
- `lib/settings-service.js`
  - Zentrale Settings-Auflösung inkl. verschlüsseltem/legacy API-Key Handling.
- `lib/model-policy.js`
  - Serverseitige Modell-Policies (Whitelist + Resolver).
- `lib/api-utils.js`
  - Einheitliche Fehlerausgabe und reduzierte Fehler-Log-Metadaten.

Erweiterungen:

- `lib/constants.js`
  - Modell-Whitelists und Standardmodelle.
- `lib/db-init.js`
  - Neue Spalte `mistral_api_key_encrypted`.
  - Neue Indizes für häufige Query-Muster.
  - Composite-FK-Härtung für Folder-Ownership (`folder_id,user_id`).

## 3.2 Auth, Secrets und DB-Init

### Auth-Härtung

Datei: `pages/api/auth/[...nextauth].js`

- Login-Rate-Limit ergänzt.
- Verbose Auth-Logs entfernt (keine Nutzer-/Passwortvergleich-Logs mehr).

### DB-Init-Härtung

Datei: `pages/api/db-init.js`

- Eigener `DB_INIT_SECRET` eingeführt.
- In Produktion standardmäßig deaktivierbar via `ENABLE_DB_INIT_API`.
- Rate-Limit ergänzt.
- Klarere Fail-Fast-Konfiguration bei fehlendem Secret.

## 3.3 API-Key-Sicherheit

Betroffene Dateien:

- `pages/api/settings.js`
- `pages/api/admin/users/[id].js`
- `pages/api/admin/users/index.js`
- `pages/api/ocr.js`
- `pages/api/text-ai.js`
- `pages/api/translate.js`
- `pages/api/templates/generate.js`
- `pages/api/transcriptions/[id]/process.js`
- `pages/api/transcriptions/[id]/analyze.js`

Umsetzung:

- API-Key wird beim Speichern verschlüsselt (`mistral_api_key_encrypted`) und nicht mehr primär im Klartext verwendet.
- Lesepfade unterstützen Legacy-Daten (`mistral_api_key`) rückwärtskompatibel.
- Admin-Übersichten behandeln `api_key_configured` jetzt korrekt für beide Speicherarten.
- In Produktion wird zum Speichern ein Encryption-Key erwartet (`SETTINGS_ENCRYPTION_KEY`).

## 3.4 Rate-Limits auf High-Risk-Endpunkten

Rate-Limits ergänzt in:

- `pages/api/auth/[...nextauth].js`
- `pages/api/db-init.js`
- `pages/api/settings.js`
- `pages/api/upload.js`
- `pages/api/ocr.js`
- `pages/api/text-ai.js`
- `pages/api/translate.js`
- `pages/api/templates/generate.js`
- `pages/api/transcriptions/[id].js`
- `pages/api/transcriptions/[id]/process.js`
- `pages/api/transcriptions/[id]/analyze.js`

Ziel: Schutz vor Brute-Force, DoS und Kosten-Spikes.

## 3.5 Modell-Whitelist und Input-Härtung

- Upload/OCR/Text-AI/Translate validieren Modellnamen serverseitig.
- Ungültige Modelle werden mit `400` abgewiesen.
- Settings validieren `preferredModel`, `ocrModel`, `costLimit` konsistent.

## 3.6 Race-Condition-Fixes und Job-Stabilität

### Atomische Status-Übergänge

Dateien:

- `pages/api/transcriptions/[id]/process.js`
- `pages/api/transcriptions/[id]/analyze.js`

Änderung:

- Statuswechsel mit atomischem `UPDATE ... WHERE status = ... RETURNING`.
- Doppelstarts werden mit `409` abgefangen.

### Stale-Job-Recovery

Dateien:

- `pages/api/transcriptions/index.js`
- `pages/api/transcriptions/[id].js`

Änderung:

- Lange hängende Jobs (`processing`/`analyzing` > 45 Min.) werden als `error` markiert.

Hinweis:

- Für maximale Robustheit bleibt perspektivisch ein externer Queue-Worker sinnvoll (BullMQ/SQS/etc.).

## 3.7 Upload/OCR Dateihandling

Dateien:

- `pages/api/upload.js`
- `pages/api/ocr.js`

Änderung:

- Temporäre Upload-Dateien werden auch bei Validierungsfehlern entfernt.
- Sichere Fehlerausgaben und reduzierte Log-Details.

## 3.8 Transcription-API Härtung

Datei: `pages/api/transcriptions/[id].js`

- Umgebaut auf robustere Struktur mit einheitlichem Error-Handling.
- PATCH in einen dynamischen Single-Update-Pfad konsolidiert.
- Folder-Ownership validiert.
- File-Delete nur für sichere Upload-Pfade.

## 3.9 UI/Runtime Bugfixes

- `pages/transcriptions.js`
  - Fehlender Import `deleteTranscription` ergänzt.
  - Null-safe Suche eingebaut.
- `pages/settings.js`
  - `costLimit`-Initialisierung null-safe korrigiert (`??` statt `||`).
- `scripts/seed-admin.js`
  - Passwortvalidierung auf Policy-Niveau ergänzt.
- `README.md`
  - Veraltete Admin-Seed-Anleitung korrigiert (`npm run seed-admin`).

## 3.10 Legacy-API-Key Migration (Plaintext -> Encrypted)

Dateien:

- `scripts/migrate-api-keys.js`
- `package.json`
- `README.md`

Umsetzung:

- Idempotentes Migrationsskript eingeführt:
  - `npm run migrate-api-keys`
- Dry-Run-Modus für sichere Vorprüfung:
  - `npm run migrate-api-keys -- --dry-run`
- Verhalten pro Datensatz:
  - Klartext vorhanden, kein Ciphertext: verschlüsseln + Klartext leeren.
  - Klartext und Ciphertext vorhanden: Klartext leeren.
  - Klartext + ungültiger Ciphertext: Ciphertext aus Klartext neu erzeugen + Klartext leeren.
- Fail-Fast ohne Key-Material (`SETTINGS_ENCRYPTION_KEY` oder `NEXTAUTH_SECRET`).
- Migration läuft in einer DB-Transaktion und ist wiederholbar.

## 3.11 Post-Migrations-Checkliste (Betrieb)

Ziel:

- Sicherstellen, dass keine Klartext-API-Keys mehr in `settings.mistral_api_key` verbleiben.
- Verifizieren, dass verschlüsselte Werte vorhanden und lesbar sind.
- Rückfallfähigkeit vor produktiver Bereinigung absichern.

Empfohlene Reihenfolge:

1. Backup erstellen (vor Write-Run):
   - DB-Dump / Snapshot nach bestehendem Betriebsstandard.
2. Dry-Run ausführen:
   - `npm run migrate-api-keys -- --dry-run`
3. Write-Run ausführen:
   - `npm run migrate-api-keys`
4. Datenbank verifizieren:
   - Restliche Klartexte prüfen:
     - `SELECT COUNT(*) AS plaintext_remaining FROM settings WHERE NULLIF(TRIM(mistral_api_key), '') IS NOT NULL;`
   - Verschlüsselte Werte prüfen:
     - `SELECT COUNT(*) AS encrypted_present FROM settings WHERE NULLIF(TRIM(mistral_api_key_encrypted), '') IS NOT NULL;`
   - Stichprobe (ohne Secret-Inhalte auszugeben):
     - `SELECT id, user_id, (mistral_api_key IS NOT NULL) AS has_plain, (mistral_api_key_encrypted IS NOT NULL) AS has_encrypted FROM settings ORDER BY id LIMIT 20;`
5. Anwendungsprüfung:
   - Mit mindestens einem betroffenen User OCR/Text-AI/Translate ausführen.
   - Erwartung: keine Änderung im Funktionsverhalten gegenüber vor der Migration.

## 3.12 UX-Verbesserungen (Wartezeit und Transparenz)

Betroffene Dateien:

- `components/ProcessStatusCard.js`
- `pages/upload.js`
- `pages/transcriptions/[id].js`
- `pages/ocr.js`
- `pages/translate.js`
- `pages/text-ai.js`
- `pages/api/transcriptions/[id].js`
- `pages/api/transcriptions/[id]/process.js`
- `pages/api/transcriptions/[id]/analyze.js`
- `pages/api/upload.js`
- `pages/api/ocr.js`
- `lib/transcription-events.js`
- `lib/db-init.js`

Umsetzung:

- Einheitliche Prozesskarte mit:
  - Schrittanzeige (z. B. Transkription -> Analyse),
  - rotierenden Lade-Texten,
  - ETA/Restzeit-Anzeige.
- Upload-Flow verbessert:
  - Live-Status via SSE direkt nach Upload,
  - Polling nur als Fallback bei Verbindungsproblemen/Browser-Limitierungen,
  - optionale Auto-Weiterleitung auf die Ergebnisansicht bei Fertigstellung.
- Detailansicht verbessert:
  - eigener Verlauf (Timeline) pro Auftrag mit Zeitstempeln und Stufen (`queued`, `processing`, `analyzing`, `completed`, `error`).
- Backend schreibt jetzt Ereignisse entlang der Verarbeitung:
  - Upload angenommen,
  - Verarbeitung gestartet,
  - Transkription fertig,
  - Analyse gestartet/fertig,
  - Fehlerfälle.

## 3.16 Warteschlangen-Fix: keine stillen `pending`-Hänger mehr

Betroffene Dateien:

- `pages/upload.js`
- `pages/transcriptions/[id].js`

Umsetzung:

- Start der Verarbeitung prüft jetzt explizit den HTTP-Status der `/process`-Route.
- Fehlermeldungen werden direkt im UI angezeigt (z. B. fehlender API-Key, Kostenlimit, Statuskonflikt).
- Nutzer können Jobs sofort neu anstoßen:
  - Upload-Seite: `Erneut starten`
  - Detailseite: `Verarbeitung starten`

Ergebnis:

- Aus Nutzersicht keine „hängt in Warteschlange“-Situation ohne Erklärung mehr.
- Schnellere Selbsthilfe ohne Admin-/DB-Eingriff.

Nutzen:

- Nutzer sehen klar, was gerade passiert (statt nur „Warte auf Text“).
- Weniger Unsicherheit bei längeren Jobs durch Status + ETA + Verlauf.
- Höhere Konsistenz über Upload-, OCR-, Translate- und Text-AI-Flows.

## 3.13 PDF-Export-Stabilisierung (Start)

Betroffene Dateien:

- `pages/api/export/pdf.js`
- `lib/pdf-export.js`
- `components/DocumentEditor.js`
- `Dockerfile`
- `config/docker-compose.dev.yml`
- `config/docker-compose.prod.yml`
- `.env.example`

Umsetzung:

- Neuer serverseitiger PDF-Exportpfad (`POST /api/export/pdf`) mit:
  - Session-Pflicht,
  - Rate-Limit,
  - Request-Validierung.
- Rendering über Chromium im Headless-Modus:
  - feste A4-Ränder,
  - Umbruchschutz für Überschriften/Tabellen/Absätze,
  - keine Browser-Header/-Footer.
- Editor exportiert PDF primär über API und nutzt Browser-Print nur als Fallback.
- Export-Look näher an App-UX gebracht:
  - fester Stil `Soft Business`
  - feste Primärschrift `Google Sans Soft` (mit Fallbacks)
- Chromium-Header/Footer vollständig unterdrückt (`--no-pdf-header-footer`), um `file:///tmp/...`-Artefakte zu vermeiden.
- API liefert PDF als `inline`, sodass das Ergebnis direkt im Browser-Tab geöffnet wird.

Nutzen:

- Reproduzierbarere PDF-Ausgaben unabhängig vom Client-Browser.
- Reduzierte Probleme mit abgeschnittenen Zeilen und Header/Footer-Artefakten.

## 3.15 Template-Default Konsistenz

Betroffene Dateien:

- `pages/api/settings.js`
- `components/AudioUploadForm.js`
- `pages/settings.js`

Umsetzung:

- `defaultTemplate` wird zentral normalisiert:
  - `generic` bleibt `generic`,
  - `custom-*` bleibt erhalten,
  - alle anderen Legacy-Werte fallen auf `generic` zurück.
- Damit ist im Upload standardmäßig `Zusammenfassung` aktiv, auch bei älteren Konten mit historischem `meeting`-Wert.

Nutzen:

- Erwartetes Default-Verhalten ist konsistent über Settings, API und Upload-UI.
- Weniger Verwirrung durch alte, inkonsistente Nutzerdaten.

## 3.14 Audioaufnahme-Runtime-Fixes

Betroffene Datei:

- `components/AudioRecorder.js`

Umsetzung:

- Visualizer-Start auf Render-Timing angepasst:
  - Start nach gesichertem Canvas-Mount statt vorzeitigem Initialisierungsversuch.
- Mikrofonsignal-Erkennung sensibler kalibriert.
- Audio-Preview beim Laden konsistent auf Startposition gesetzt.

Nutzen:

- Wellenanzeige und Signalstatus funktionieren verlässlicher bei Browser-Aufnahme.
- Vorschau wirkt konsistenter für Nutzer.

## 4) Konfigurationsänderungen

### Neue/erweiterte Env-Variablen

Dateien:

- `.env.example`
- `config/docker-compose.dev.yml`
- `config/docker-compose.prod.yml`

Neu:

- `DB_INIT_SECRET`
- `SETTINGS_ENCRYPTION_KEY`
- `ENABLE_DB_INIT_API`

## 5) Verifikation

Ausgeführt:

- `npm run build`
  - Ergebnis: „Compiled successfully“ erreicht.
  - Danach Sandbox-bedingter `EPERM listen 0.0.0.0` bei `Collecting page data` (Umgebungsrestriktion, kein Codefehler).
- `npm run migrate-api-keys -- --dry-run`
  - Ohne gesetztes Key-Material erwartungsgemäß Fail-Fast (Security Guard).
- `SETTINGS_ENCRYPTION_KEY=test-key npm run migrate-api-keys -- --dry-run`
  - In dieser Sandbox nicht vollständig ausführbar (DB-Connect `EPERM` auf `localhost:5432`).

Nicht vollständig möglich in dieser Umgebung:

- `npm run lint` (interaktiver ESLint-Setup-Dialog mangels finaler ESLint-Config).
- `npm audit` (kein externer Registry-Zugriff in Sandbox).

## 6) Kompatibilität und erwartetes Verhalten

Die Maßnahmen sind auf Funktionskompatibilität ausgelegt:

- Bestehende Endpunkte und Hauptflüsse bleiben erhalten.
- Sicherheitsverstärkungen greifen transparent (Rate-Limits, Validierung, bessere Fehlerbehandlung).
- Legacy-Klartext-API-Keys bleiben lesbar; neue Speicherung ist verschlüsselt.
- Mit Migrationsskript können Legacy-Klartextwerte ohne Funktionsverlust entfernt werden.

Mögliche sichtbare Änderungen:

- Bei Missbrauch oder Burst-Traffic können `429` Antworten auftreten.
- Ungültige Modellnamen werden jetzt explizit abgewiesen.
- Stale-Jobs werden automatisch als Fehler markiert.

## 7) Offene Empfehlungen (nächste Ausbaustufe)

1. Asynchrones Job-System mit dediziertem Worker (Queue), um App-Prozess-Lebensdauer vollständig zu entkoppeln.
2. Optional Redis-basierter verteilter Rate-Limiter für Multi-Instance-Betrieb.
3. CI-Lint/Test-Pipeline vervollständigen (feste ESLint-Konfiguration + API/Integrationstests).
4. Secret-Rotation-Runbook ergänzen (z. B. geplanter Wechsel von `SETTINGS_ENCRYPTION_KEY` mit kontrollierter Re-Encryption).

## 8) Geänderte Kern-Dateien

- `lib/constants.js`
- `lib/db-init.js`
- `lib/db.js`
- `lib/usage.js`
- `lib/secrets.js`
- `lib/settings-service.js`
- `lib/rate-limit.js`
- `lib/model-policy.js`
- `lib/api-utils.js`
- `lib/transcription-events.js`
- `pages/api/auth/[...nextauth].js`
- `pages/api/db-init.js`
- `pages/api/settings.js`
- `pages/api/upload.js`
- `pages/api/ocr.js`
- `pages/api/text-ai.js`
- `pages/api/translate.js`
- `pages/api/templates/generate.js`
- `pages/api/transcriptions/[id].js`
- `pages/api/transcriptions/[id]/process.js`
- `pages/api/transcriptions/[id]/analyze.js`
- `pages/api/transcriptions/index.js`
- `pages/api/admin/users/index.js`
- `pages/api/admin/users/[id].js`
- `pages/api/user/profile.js`
- `pages/transcriptions.js`
- `pages/transcriptions/[id].js`
- `pages/upload.js`
- `pages/ocr.js`
- `pages/translate.js`
- `pages/text-ai.js`
- `components/ProcessStatusCard.js`
- `pages/settings.js`
- `scripts/seed-admin.js`
- `scripts/migrate-api-keys.js`
- `package.json`
- `.env.example`
- `config/docker-compose.dev.yml`
- `config/docker-compose.prod.yml`
- `README.md`
