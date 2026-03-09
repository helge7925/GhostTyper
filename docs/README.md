# GhostTyper Dokumentation

Stand: 2026-03-08

## Start hier

- Produkt/Setup: `../README.md`
- Aktueller Planstatus: `../PROJECT_PLAN.md`
- Release Notes: `release-notes-2026-02-12.md`
- Changelog: `../CHANGELOG.md`

## Version 1.2.0 (2026-02-19)

### Neue Features
- **Volltext-Suche**: Durchsucht Transkripte und Analysen serverseitig
- **Vorlagen-Kategorien**: Organisation in selbst erstellten Kategorien

### API-Änderungen
- `GET /api/transcriptions?search=` - Neuer Suchparameter
- `GET/POST/PUT/DELETE /api/template-categories` - Neue Endpunkte

### Datenbank-Migration
- Tabelle `template_categories` (id, user_id, name, color, position)
- Spalte `templates.category_id` (FK zu template_categories)

## Update (2026-03-08)

### Sketch Summary mit Gemini
- Neue Seite: `/sketch`
- API: `POST /api/sketch-summary`
- Modellgestützte Mehrstufen-Pipeline:
  - Struktur-JSON (Semantik)
  - Illustrationsplanung
  - deterministisches SVG-Rendering
- Ausgabe: Vektor-SVG (Base64), Querformat
- Rollout-/Abnahmedetails: `sketch-summary-rollout-2026-03-08.md`
- Container-Rebuild-Log: `container-rebuild-2026-03-08.md`

### Datentabelle + Dashboard API-Status
- Neue Seite: `/datentabelle`
- Extraktion als Datentabelle aus Audio, Text und OCR
- Dashboard zeigt API-Status separat für Mistral und Google
- Rollout-/Abnahmedetails: `datentabelle-rollout-2026-03-08.md`

### Settings & Migration
- Neues Settings-Feld in der UI: **Google API-Key (Gemini)**
- Neue DB-Spalten in `settings`:
  - `google_api_key`
  - `google_api_key_encrypted`
  - `member_monthly_budget_limit`

## Reviews & Prioritäten

- Internes Hardening-Review (2026-02-11): `code-review-hardening-2026-02-11.md`
- Externes Kollegenreview (2026-02-12): `external-review-2026-02-12.md`
- Umsetzungsstatus P0-P3: `code-review-priorities-p0-p3-2026-02-12.md`
- Debug-/Abnahmebericht (2026-02-20): `debug-report-2026-02-20.md`

## Technik & Betrieb

- Implementierung: `implementation.md`
- Tests/Abnahme: `testing.md`
- API: `api-specification.md`
- Docker lokal: `docker-setup.md`
- VPS/Traefik: `vps-deployment-guide.md`
- Umgebungsanalyse Ziel-VPS: `umgebungsanalyse.md`
- Troubleshooting Docker: `docker-troubleshooting.md`
- Auth Troubleshooting: `troubleshooting-auth.md`

## Produktdokumente

- Features (Kurzfassung im README): `../README.md`
- Feature-Index/Weiterführende Links: `features-and-improvements.md`
- Audio-Flow: `audio-upload.md`
- KI-Integration: `ai-integration.md`

## Hinweis zur Doku-Philosophie

- Link-first: Details nur in Fachdokumenten.
- Keine redundanten Volltexte über mehrere Dateien hinweg.
- `PROJECT_PLAN.md` und Release Notes sind die maßgeblichen Statusquellen.
