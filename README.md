# GhostTyper

GhostTyper ist eine selbstgehostete Webanwendung für:
- Audio-Transkription
- OCR (Dokumente/Fotos)
- KI-Zusammenfassungen und Textverarbeitung
- Übersetzungen
- editor-zentrierte Dokumentbearbeitung (PDF/DOCX)

Stack: Next.js 13, React 18, PostgreSQL 16, NextAuth, Mistral API, Docker Compose.

![GhostTyper Screenshot](public/logo-text.png)

## Kurzüberblick

GhostTyper ist für Teams gedacht, die Sprache und Dokumente schnell in verwertbare Ergebnisse überführen möchten – lokal betreibbar und mit klarem Fokus auf zuverlässige Abläufe.

- Audio hochladen oder direkt im Browser aufnehmen, inkl. Sprechertrennung.
- PDFs/Bilder per OCR erfassen und direkt weiterverarbeiten.
- Inhalte mit KI zusammenfassen, strukturieren oder übersetzen.
- Ergebnisse im zentralen Editor finalisieren und als PDF/DOCX exportieren.
- Historie, Favoriten und Ordner für wiederkehrende Arbeitsschritte.
- Self-Hosted mit Next.js, PostgreSQL, NextAuth und Docker Compose.
- Sicherheitsbasis mit Rate-Limits, verschlüsselten API-Keys und klaren Status-Übergängen.

## Code-Review Prioritäten (P0-P3)

Status: vollständig umgesetzt (Stand 2026-02-12).

Quelle der Prioritäten: externes Kollegenreview (`docs/external-review-2026-02-12.md`).

- P0 (kritisch): XSS-Härtung im Editor, Input-Limits bei `save-doc`, Secrets-Fallback entfernt.
- P1 (hoch): Duplikate zentralisiert (Analysis-/Template-/Stale-Logik), transaktionales Admin-Update, wartbarer Settings-Updatepfad.
- P2 (mittel): Queue/Worker-Entkopplung (`queued`) + Observability-Basis (`/api/health`, `/api/admin/observability`).
- P3 (mittel): PDF-Paginierung verbessert + Mikro-UX-Vereinfachungen im Editor/Statusflow.
- Vollständiges Änderungsprotokoll: `docs/code-review-priorities-p0-p3-2026-02-12.md`.

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
- `PDF_EXPORT_MAX_CONCURRENCY`
- `PDF_EXPORT_QUEUE_TIMEOUT_MS`
- `TRANSCRIPTION_WORKER_CONCURRENCY`
- `TRANSCRIPTION_WORKER_SCAN_INTERVAL_MS`
- `TRANSCRIPTION_WORKER_SCAN_BATCH`
- `LOG_FORMAT` (`json` oder `plain`)
- `LOG_LEVEL` (`debug`, `info`, `warn`, `error`)

## Observability

- Strukturierte Server-Logs über `LOG_FORMAT=json` (Default).
- Laufzeitmetriken im Healthcheck unter `GET /api/health` (worker/db/counters).
- Erweiterte Metriken für Admins unter `GET /api/admin/observability`.

## Qualitäts-/Build-Hinweis

- `npm run build` kompiliert die Anwendung.
- In restriktiven Sandbox-Umgebungen kann der Build bei `Collecting page data` mit `EPERM listen 0.0.0.0` abbrechen. Das ist umgebungsbedingt und kein Compile-Fehler der Anwendung.

## Dokumentation

- Übersicht: `docs/README.md`
- Feature-Index (kompakt): `docs/features-and-improvements.md`
- Security Review & Hardening: `docs/code-review-hardening-2026-02-11.md`
- Externes Review: `docs/external-review-2026-02-12.md`
- Prioritäten-Umsetzung P0-P3: `docs/code-review-priorities-p0-p3-2026-02-12.md`
- Projektplan: `PROJECT_PLAN.md`

## Lizenz

Private Nutzung.
