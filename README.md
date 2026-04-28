# GhostTyper

GhostTyper ist eine selbstgehostete Webanwendung für:
- Audio-Transkription
- OCR (Dokumente/Fotos)
- KI-Zusammenfassungen und content-only Datentabellen
- Übersetzungen
- editor-zentrierte Dokumentbearbeitung (PDF/DOCX/XLSX für Tabellen)

Stack: Next.js 13, React 18, PostgreSQL 16, NextAuth, Mistral API, Docker Compose.

![GhostTyper Screenshot](public/logo-text.png)

## Kurzüberblick

GhostTyper ist für Teams gedacht, die Sprache und Dokumente schnell in verwertbare Ergebnisse überführen möchten – lokal betreibbar und mit klarem Fokus auf zuverlässige Abläufe.

- Audio hochladen oder direkt im Browser aufnehmen, inkl. Sprechertrennung.
- PDFs/Bilder per OCR erfassen und direkt weiterverarbeiten.
- Inhalte mit KI zusammenfassen, strukturieren oder übersetzen.
- Ergebnisse im zentralen Editor finalisieren und als PDF/DOCX exportieren; Tabellen zusätzlich sauber als Excel-Datei.
- Historie, Favoriten und Ordner für wiederkehrende Arbeitsschritte.
- **Volltext-Suche** über alle Transkripte und Analysen (v1.2.0).
- **Vorlagen-Kategorien** für bessere Organisation (v1.2.0).
- **Auto-Glossar**: Kontextwörter aus der Historie vorschlagen und mit einem Klick übernehmen.
- **Intelligente Modellauswahl + Kostenvorschau** vor dem Start in Upload und Übersetzung.
- **Datentabelle**: Strukturierte Daten aus Audio, Text oder PDF/Bild extrahieren, mit Metadaten, Zeilentiteln, Spaltentiteln und Excel-Export.
- **Excel-artiger Tabellen-Vorlagen-Editor**: Tabellen-Vorlagen in den Einstellungen intuitiv als Raster definieren; KI füllt ausschließlich Inhalte, keine Berechnungen.
- **Tabellen-Canvas**: Befüllte Tabellen in der Detailansicht nachbearbeiten und speichern.
- Konzept für die nächste Ausbaustufe: automatische Tabellen-Vorlagenerzeugung aus Foto/Scan/PDF.
- Versionshinweis: Aktuell released `v1.2.0`; nächste Feature-Welle als `v1.3.0` dokumentiert.
- Self-Hosted mit Next.js, PostgreSQL, NextAuth und Docker Compose.
- Sicherheitsbasis mit Rate-Limits, verschlüsselten API-Keys und klaren Status-Übergängen.

## Produktivitätsfeatures (neu)

- Auto-Glossar-API: `GET /api/glossary/suggestions`
- Modell-Assistent: `POST /api/model-assistant`
- Tabellen-Vorlagen: Metadaten, feste Zeilentitel, Spaltenraster und content-only Prompting.
- Tabellen-Export: CSV, HTML und sauber formatiertes XLSX mit Metadaten oberhalb der Tabelle.

Hinweis zur Kompatibilität:
- `PUT /api/settings` und `POST /api/settings` werden beide unterstützt.

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
docker compose -f config/docker-compose.dev.yml exec transkription-webapp \
  sh -lc "wget -q -S -O - --post-data '' --header 'x-init-secret: dev-db-init-secret' http://127.0.0.1:3000/api/db-init"
```

Hinweis:
- Der direkte Host-Call auf `http://localhost:3000/api/db-init` kann wegen Maintenance-ACL mit `403 Forbidden` blockiert sein.
- Der In-Container-Aufruf oben ist der verlässliche Weg für lokale Dev-Migrationen.

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
- `HTTP_CLIENT_TIMEOUT_MS`
- `HEALTH_DETAILS_PUBLIC`
- `HEALTH_DETAILS_SECRET`
- `UPLOAD_VIRUS_SCAN_MODE`
- `UPLOAD_VIRUS_SCAN_CMD`
- `UPLOAD_VIRUS_SCAN_FAIL_OPEN`
- `UPLOAD_VIRUS_SCAN_TIMEOUT_MS`
- `LOG_FORMAT` (`json` oder `plain`)
- `LOG_LEVEL` (`debug`, `info`, `warn`, `error`)

## Observability

- Strukturierte Server-Logs über `LOG_FORMAT=json` (Default).
- `GET /api/health` liefert standardmäßig nur einen schlanken Health-Status.
- Laufzeitmetriken im Healthcheck nur mit `HEALTH_DETAILS_PUBLIC=true` oder Header `x-health-secret` (bei gesetztem `HEALTH_DETAILS_SECRET`).
- Erweiterte Metriken für Admins unter `GET /api/admin/observability`.

## Qualitäts-/Build-Hinweis

- `npm run build` kompiliert die Anwendung.
- `npm test` führt die automatischen Unit-Tests für die Tabellenlogik und Tabellen-Prompts aus.
- `npm run smoke` führt einen Docker/API-Smoke-Test durch.
- `npm run smoke:full` führt zusätzlich `test + lint + build` sowie PDF-Renderer-Check aus.
- In restriktiven Sandbox-Umgebungen kann der Build bei `Collecting page data` mit `EPERM listen 0.0.0.0` abbrechen. Das ist umgebungsbedingt und kein Compile-Fehler der Anwendung.

## Dokumentation

- Übersicht: `docs/README.md`
- Feature-Index (kompakt): `docs/features-and-improvements.md`
- Tabellen-Vorlagen: `docs/TABLE_TEMPLATES.md`
- Konzept Foto-zu-Tabellenvorlage: `docs/konzept-automatische-tabellengenerierung-aus-foto.md`
- Geplante v1.3.0 Features: `docs/v1.3.0-features.md`
- Security Review & Hardening: `docs/code-review-hardening-2026-02-11.md`
- Externes Review: `docs/external-review-2026-02-12.md`
- Prioritäten-Umsetzung P0-P3: `docs/code-review-priorities-p0-p3-2026-02-12.md`
- Projektplan: `PROJECT_PLAN.md`

## Lizenz

Private Nutzung.
