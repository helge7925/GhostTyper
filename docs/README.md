# GhostTyper Dokumentation

Stand: 2026-06-17 · Aktuelle Version: 0.3.0

Quelle der Wahrheit für laufende Releases ist immer der Changelog;
diese Index-Seite ist eine Navigation, kein Status-Tracker.

## Start hier

- **Produkt-Übersicht & Schnellstart**: [`../README.md`](../README.md)
- **Architektur**: [`architecture.md`](architecture.md) — Container,
  Datenflüsse, DB-Tabellen, Resource-Footprint
- **Docker-Setup**: [`docker-setup.md`](docker-setup.md) — Compose-Stack
  Production + Development, ENV-Variablen, Build-Details

## Operations

- **VPS-Deployment**: [`vps-deployment-guide.md`](vps-deployment-guide.md) —
  Production-Deploy mit Traefik
- **Vexa-Remote-Meeting**: [`vexa-integration.md`](vexa-integration.md) —
  Bot-Stack, Webhook-Auto-Registrierung, Operator-Dashboard,
  `VEXA_LITE_IMAGE`-Override für den Nextcloud-Talk-Fork, Reconcile-Cron
- **CI/CD**: [`ci-cd-pipeline.md`](ci-cd-pipeline.md) — GitHub-Actions-
  Workflows
- **Docker-Troubleshooting**: [`docker-troubleshooting.md`](docker-troubleshooting.md)
- **Auth-Troubleshooting**: [`troubleshooting-auth.md`](troubleshooting-auth.md)

## Funktion & API

- **API-Referenz**: [`api-specification.md`](api-specification.md)
- **AI-Integration**: [`ai-integration.md`](ai-integration.md) — Mistral-
  Modell-Auswahl (Voxtral / Large / Medium / Small / OCR)
- **Authentifizierung**: [`authentication.md`](authentication.md) —
  NextAuth, OIDC, Credentials
- **Audio-Upload-Pipeline**: [`audio-upload.md`](audio-upload.md)
- **Tabellen-Vorlagen**: [`TABLE_TEMPLATES.md`](TABLE_TEMPLATES.md) —
  Schema, Excel-Export, manueller Builder
- **Konzept Auto-Tabellen aus Fotos**: [`konzept-automatische-tabellengenerierung-aus-foto.md`](konzept-automatische-tabellengenerierung-aus-foto.md)
  (Roadmap, nicht implementiert)
- **Feature-Liste**: [`features-and-improvements.md`](features-and-improvements.md)

## Tests & Quality

- **Test-Strategie**: [`testing.md`](testing.md)
- **E2E-Regression-Matrix**: [`e2e-regression-matrix.md`](e2e-regression-matrix.md)
- **Cybersecurity-Audit (2026-02-21)**: [`cybersecurity-audit-2026-02-21.md`](cybersecurity-audit-2026-02-21.md)

## Customer-Varianten (separate Repos)

GhostTyper ist die Upstream-Codebase. Zwei Customer-Variants leben in
eigenen Repositories und kommen mit reduzierten Feature-Sets:

- **Romaco-Scriptor** ([`helge7925/romaco-scriptor`](https://github.com/helge7925/romaco-scriptor))
  — Pharma-Variante mit Vexa, Pharma-Glossar, eigenem Branding
- **Korrotec-Scriptor** ([`helge7925/korrotec_scriptor`](https://github.com/helge7925/korrotec_scriptor))
  — Korrosionsschutz-Variante OHNE Vexa, mit Tagesrapport-Tabellenvorlage,
  4 eingebauten Datentabellen-Schemas, Korrotec-Glossar

Beide forken Schema und Code von hier. Cross-Repo-Cherry-Picks sind der
übliche Weg, Features upstream zu pushen.

## Doku-Philosophie

- **Link-first**: Details leben im Fachdokument, nicht im Index.
- **Quelle der Wahrheit für aktuellen Stand** ist der Changelog
  (`../CHANGELOG.md`) — nicht diese Index-Seite. Die Versions-Sektionen
  unten sind ein Archiv großer Sprünge, nicht eine laufende Status-
  Anzeige.

---

## Archivierte Sprung-Notizen

### 1.2.0 (2026-02-19)

- **Volltext-Suche**: Durchsucht Transkripte und Analysen serverseitig
- **Vorlagen-Kategorien**: Organisation in selbst erstellten Kategorien
- API: `GET /api/transcriptions?search=`, `*/api/template-categories`
- Schema: Tabelle `template_categories` + FK `templates.category_id`

### Update 2026-03-08

- Neue Seite `/datentabelle`: Extraktion als Datentabelle aus Audio,
  Text und OCR
- Settings: `member_monthly_budget_limit`-Feld + DB-Spalte

### Update 2026-04-28

- **Funktionsbereinigung**: Echtzeitverarbeitung, Wissensgraph, Mindmap,
  Infografik/Sketch, Text-Assistent und Workflow-Seiten entfernt;
  Google/Gemini-Key-Verwaltung aus UI/API/Deps gestrichen.
- Tabellen-Vorlagen sind content-only (keine Berechnungen/Formeln durch
  das KI-Modell). Excel-Export mit sauberen Metadaten-Headern.
- Text- und Tabellen-Templates getrennt, aber gemeinsame Kategorien.
