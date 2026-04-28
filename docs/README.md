# GhostTyper Dokumentation

Stand: 2026-04-28

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

### Datentabelle + Dashboard API-Status
- Neue Seite: `/datentabelle`
- Extraktion als Datentabelle aus Audio, Text und OCR
- Rollout-/Abnahmedetails: `datentabelle-rollout-2026-03-08.md`

### Settings & Migration
- Neues Settings-Feld in der UI: Mitglieder-Budgetlimit
- Neue DB-Spalte in `settings`: `member_monthly_budget_limit`

## Update (2026-04-28)

### Funktionsbereinigung
- Entfernt: Echtzeitverarbeitung, Wissensgraph, Mindmap, Infografik/Sketch, Text-Assistent und Workflow-Seiten.
- Google/Gemini-Key-Verwaltung wurde aus UI, API und Abhängigkeiten entfernt.
- Die aktive App konzentriert sich auf Upload/OCR, Transkription, Übersetzung, Zusammenfassung, Datentabellen, Editor und Export.

### Tabellen-Vorlagen und Excel-Export
- Tabellen-Vorlagen sind content-only: keine Berechnungen, Formeln oder Summen durch das KI-Modell.
- Neuer Excel-artiger Editor für Metadaten, Spaltentitel und Zeilentitel in den Einstellungen.
- Befüllte Tabellen sind in der Transkriptionsdetailansicht in einem Canvas-artigen Tabelleneditor bearbeitbar.
- Export nach CSV, HTML und sauber formatiertem Excel (`.xlsx`) mit Metadaten oberhalb der Tabelle.
- Technische Details: `TABLE_TEMPLATES.md`
- Konzept nächste Ausbaustufe: `konzept-automatische-tabellengenerierung-aus-foto.md`

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
- Tabellen-Vorlagen: `TABLE_TEMPLATES.md`
- Konzept Foto-zu-Tabellenvorlage: `konzept-automatische-tabellengenerierung-aus-foto.md`
- Audio-Flow: `audio-upload.md`
- KI-Integration: `ai-integration.md`

## Hinweis zur Doku-Philosophie

- Link-first: Details nur in Fachdokumenten.
- Keine redundanten Volltexte über mehrere Dateien hinweg.
- `PROJECT_PLAN.md` und Release Notes sind die maßgeblichen Statusquellen.
