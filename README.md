# GhostTyper

GhostTyper ist eine selbstgehostete Webanwendung für:
- Audio-Transkription
- OCR (Dokumente/Fotos)
- KI-Zusammenfassungen und Textverarbeitung
- Übersetzungen
- editor-zentrierte Dokumentbearbeitung (PDF/DOCX)

Stack: Next.js 13, React 18, PostgreSQL 16, NextAuth, Mistral API, Docker Compose.

![GhostTyper Screenshot](public/logo-text.png)

## Funktionsumfang

### Audio & Transkription
- Upload von Audio-Dateien (inkl. robuster MIME-/Extension-Prüfung)
- Browser-Aufnahme (Desktop & Mobile)
- Diarisierung mit Sprecherzuweisung
- Optional sofortige Folgeanalyse nach Transkription
- Standard-Analysemodus beim Upload: `Zusammenfassung` (`generic`)
- Kontext-Bias (Begriffe/Domainvokabular)

### OCR & Dokumente
- OCR für PDF und Bilder
- Kamera-Upload für mobile Nutzung
- Optional direkte KI-Analyse nach OCR
- Speicherung der OCR-Ergebnisse in der Historie

### KI-Analyse & Textverarbeitung
- Analysemodi: Zusammenfassung, Meeting, Aufmaß, Custom Templates
- Modellauswahl mit serverseitiger Modell-Policy (Whitelist)
- Text-Assistent mit verwaltbaren Aufgaben (text_tasks)
- Übersetzung als eigener Workflow

### Editor-zentrierter Workflow
- Einheitlicher Document Editor für Ergebnisbearbeitung
- PDF/DOCX-Export (PDF primär serverseitig via Chromium, mit lokalem Fallback)
- PDF-Export nutzt standardmäßig einen festen Stil:
  - Stil: `Soft Business`
  - Schrift: `Google Sans Soft` (mit robusten Fallbacks)
- Premium-Layout ist pro Export im Editor zuschaltbar
- Premium-Daten (Firma/Name/Rolle/Kontakt/Fußzeile) werden zentral in den Einstellungen gepflegt
- Optionaler PDF-Kopfbereich als dezente Signatur (Titel, Datum, optional Projekt)
- PDF wird nach Export standardmäßig direkt im Browser-Tab geöffnet
- Kein erzwungener Download-Fallback beim PDF-Export (bei blockierten Pop-ups erscheint ein Hinweis)
- Historie mit Favoriten/Ordnern
- Übersetzungsfunktion auf den Editor fokussiert (kein Parallel-Workflow mehr in der Detailseite)

### UX-Verbesserungen (neu)
- Einheitliche Prozesskarte (`ProcessStatusCard`) mit:
  - Schrittanzeige
  - Restzeitindikator (ETA)
  - rotierenden Lade-Texten
- Auto-Weiterleitung nach Upload, sobald Ergebnis bereit ist (optional)
- Event-Timeline pro Auftrag in der Detailansicht (Verlauf)
- Live-Status über SSE bei laufenden Transkriptionsjobs (Polling nur als Fallback)

### Sicherheit & Betriebsstabilität (neu)
- API-Key-Verschlüsselung (`settings.mistral_api_key_encrypted`)
- Migrationsskript für Legacy-Klartext-Keys (`npm run migrate-api-keys`)
- Rate-Limits auf kritischen API-Routen
- Atomische Statusübergänge bei Transkriptions-/Analysejobs
- Stale-Job-Recovery (hängende Jobs werden auf `error` gesetzt)
- Sicheres Dateilöschen nur innerhalb des Upload-Verzeichnisses
- Separates `DB_INIT_SECRET`; `db-init` in Produktion standardmäßig deaktivierbar

## Schnellstart (Docker Dev)

### 1. Starten
```bash
docker compose -f config/docker-compose.dev.yml up --build -d
```

### 2. Datenbank initialisieren
```bash
curl -X POST http://localhost:3000/api/db-init -H "x-init-secret: dev-db-init-secret"
```

### 3. Optional: Admin anlegen/aktualisieren
```bash
npm run seed-admin
```

## API-Key-Migration (Legacy Klartext -> verschlüsselt)

Wenn ältere Einträge noch `settings.mistral_api_key` (Klartext) enthalten:

### 1. Umgebung setzen
```bash
export SETTINGS_ENCRYPTION_KEY='dev-settings-encryption-key'
export DATABASE_URL='postgresql://transkription:transkription@localhost:5432/transkription'
```

### 2. Dry-Run
```bash
npm run migrate-api-keys -- --dry-run
```

### 3. Write-Run
```bash
npm run migrate-api-keys
```

### 4. Verifikation
```bash
docker compose -f config/docker-compose.dev.yml exec transkription-db \
  psql -U transkription -d transkription -c "SELECT COUNT(*) AS plaintext_remaining FROM settings WHERE NULLIF(TRIM(mistral_api_key), '') IS NOT NULL;"

docker compose -f config/docker-compose.dev.yml exec transkription-db \
  psql -U transkription -d transkription -c "SELECT COUNT(*) AS encrypted_present FROM settings WHERE NULLIF(TRIM(mistral_api_key_encrypted), '') IS NOT NULL;"
```

## Wichtige Umgebungsvariablen

Siehe `.env.example`.

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `MISTRAL_API_KEY`
- `DB_INIT_SECRET`
- `ENABLE_DB_INIT_API`
- `SETTINGS_ENCRYPTION_KEY`
- `PDF_CHROMIUM_PATH`

## Qualitäts-/Build-Hinweis

- `npm run build` kompiliert die Anwendung.
- In restriktiven Sandbox-Umgebungen kann der Build bei `Collecting page data` mit `EPERM listen 0.0.0.0` abbrechen. Das ist umgebungsbedingt und kein Compile-Fehler der Anwendung.

## Dokumentation

- Übersicht: `docs/README.md`
- Feature- und Verbesserungsstand: `docs/features-and-improvements.md`
- Security Review & Hardening: `docs/code-review-hardening-2026-02-11.md`
- Projektplan: `PROJECT_PLAN.md`

## Lizenz

Private Nutzung.
