# Debug- und Abnahmebericht (2026-02-20)

## Scope

- Produktivitäts-Punkte 1-3 umgesetzt:
  - Auto-Glossar
  - Intelligente Modellauswahl mit Kostenvorhersage
  - 1-Klick-Workflows (ohne Mail-Versandintegration)
- Vorherige Stabilitätsfixes verifiziert:
  - PDF-Renderer-Fallback/Chromium-Sandbox
  - Tabellen-/Excel-Pipeline
- Erweiterungsblock (ohne Testabdeckung):
  - Workflow-Editor + Versionierung/Rollback
  - Realtime-Robustheit + Finalisierung
  - Budget-Guardrails + Traffic-Light
  - Audit-Log + Upload-Virus-Scan-Hook

## Behobene Ursachen und Änderungen

### PDF-Renderer

- Ursache: Chromium-Sandbox scheitert in restriktiven Container-Umgebungen (`operation not permitted` / Namespace-Fehler).
- Lösung:
  - Automatischer Fallback auf `--no-sandbox` in `lib/pdf-export.js`.
  - Docker Defaults gesetzt:
    - `PDF_CHROMIUM_PATH=/usr/bin/chromium-browser`
    - `PDF_CHROMIUM_NO_SANDBOX=true`

### Tabellen-/Excel-Pipeline

- Korrektur der Persistenz für Tabellen-Analysen:
  - `analysis_type='table'`
  - `table_schema` korrekt gespeichert/geliefert
- API-Response für Transkriptionsdetails ergänzt um:
  - `analysis_type`
  - `table_schema`
  - `document_html`
- UI-Fix im Tabellen-Renderer (Footer/Index-Laufzeitproblem).

### Produktivitätsfeatures

- Auto-Glossar
  - Backend: Kandidaten aus Historie extrahieren und als Vorschläge liefern.
  - Frontend: aktive Kontextbegriffe sichtbar, entfernbar, per Klick erweiterbar.
- Modellassistent
  - Schätzung von Token/Kosten je Tasktyp.
  - Budget-/Ziel-abhängige Modell-Empfehlung.
  - In Upload, Text-AI und Übersetzung eingebunden.
- 1-Klick-Workflows
  - Workflows als serverseitige Schrittketten.
  - Kostenlimit-Prüfung und Usage-Logging pro Schritt.
  - Workflow-Set ohne Mailversandintegration.

### Workflow-Versionierung

- Eigene Workflows versionierbar gespeichert:
  - `user_workflows`
  - `user_workflow_versions`
- APIs:
  - `POST /api/workflows`
  - `GET /api/workflows/[workflowId]/versions`
  - `POST /api/workflows/[workflowId]/rollback`
  - `DELETE /api/workflows/[workflowId]`

### Realtime-Finalisierung

- Abschluss-Status `completed` triggert Finalisierungs-Pass.
- Neue Session-Felder:
  - `finalization_state`
  - `finalization_error`
  - `finalized_at`
- Duplicate-Chunk-Handling verhindert unnötige Dopplungen im Live-Transkript.

### Tabellen-Validierung

- Serverseitige Normalisierung gegen `table_schema`.
- Persistenz von `analysis_meta`:
  - `missing_fields_by_row`
  - `unvollstaendige_daten`
- Frontend zeigt unvollständige Zeilen/Felder sichtbar an.

### Security/Ops

- Audit-Log:
  - DB-Tabelle `audit_log`
  - API `GET /api/audit-log`
- Upload-Security:
  - Optionaler Virus-Scan-Hook vor Persistenz in `/api/upload`.

## Technische Verifikation

- `npm run lint` -> erfolgreich, keine ESLint-Fehler.
- `npm run build` -> erfolgreich, neue Routen werden gebaut:
  - `/api/glossary/suggestions`
  - `/api/model-assistant`
  - `/api/workflows`
  - `/api/workflows/execute`
- Docker-Dev-Stack:
  - Webapp und Postgres `healthy`
  - `http://localhost:3000` -> `200 OK`
  - `http://localhost:3000/api/health` -> `200 OK`

## Nachtest (2026-02-20, 17:04 UTC)

### Ausgeführte Checks

- Statische Verifikation:
  - `npm run lint` -> erfolgreich.
  - `npm run build` -> erfolgreich.
- Docker-Deployment neu gebaut:
  - `docker compose -f config/docker-compose.dev.yml up --build -d` -> erfolgreich.
- API-Smoke-Tests gegen Docker-Instanz auf `localhost:3000`:
  - `GET /api/health` -> `200 OK`.
  - Workflow-/Audit-Endpunkte erreichbar:
    - `GET /api/workflows` -> `401` (ohne Login, erwartet).
    - `POST /api/workflows/execute` -> `401` (ohne Login, erwartet).
    - `POST /api/workflows/{id}/versions` -> `405` (Method not allowed, Route existiert).
    - `GET /api/workflows/{id}/rollback` -> `405` (Method not allowed, Route existiert).
    - `GET /api/workflows/{id}` -> `405` (Method not allowed, Route existiert).
    - `POST /api/audit-log` -> `405`; `GET /api/audit-log` -> `401` (ohne Login, erwartet).

### Wichtiger Befund

- Ohne DB-Migrationen waren neue Tabellen/Spalten zunächst **nicht** vorhanden:
  - `audit_log`, `user_workflows`, `user_workflow_versions`
  - `settings.member_monthly_budget_limit`
  - `transcriptions.analysis_meta`
  - `realtime_sessions.finalization_*`
- Nach `POST /api/db-init` (mit Header `x-init-secret`) wurden alle Objekte korrekt angelegt.

### Lokaler Dev-Start (ohne Docker)

- `npm run dev` auf Port `3001` liefert für API-Routen `500`, wenn `DATABASE_URL` fehlt.
- Fehlerbild: `DATABASE_URL ist nicht gesetzt. Bitte Umgebungsvariablen prüfen.`
- Erwartetes Verhalten; Fix:
  - entweder Docker-Dev-Stack nutzen,
  - oder lokal `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `DB_INIT_SECRET` setzen.

## Re-Test (2026-02-20, 17:24 UTC)

### Vollständige Laufkette

- `npm test` -> erfolgreich (`7/7` Tests grün).
- `npm run lint` -> erfolgreich (keine ESLint-Fehler).
- `npm run build` -> erfolgreich (alle neuen API/UI-Routen gebaut).

### Docker + API-Smoke

- `docker compose -f config/docker-compose.dev.yml up -d` -> Container laufen und sind `healthy`.
- `GET /api/health` -> `200 OK`.
- `GET /api/workflows` -> `401 Unauthorized` (ohne Login, erwartet).
- `POST /api/workflows/execute` -> `401 Unauthorized` (ohne Login, erwartet; im Container verifiziert).
- `POST /api/db-init` ohne Secret -> `403 Forbidden` (erwartet).
- `POST /api/db-init` mit `x-init-secret` -> `200 OK` (`Database initialized`).

### PDF-Renderer-Verifikation (Chromium)

- Test **ohne** `--no-sandbox` -> Prozessabbruch mit Namespace-Fehlern (`Operation not permitted`).
- Test **mit** `--no-sandbox` -> `EXIT:0`, PDF wurde erzeugt (`/tmp/ctest.pdf`).
- Schlussfolgerung: Der bisherige Fallback-Befund ist reproduzierbar; der gesetzte Betrieb mit `PDF_CHROMIUM_NO_SANDBOX=true` ist in dieser Umgebung notwendig.

### Besonderheit der Testumgebung

- `curl http://localhost:3000/api/settings` von Host-Seite war in dieser Umgebung mehrfach nicht erreichbar (`curl: (7)`), während andere Endpunkte parallel erreichbar waren.
- Gegenprobe im Webapp-Container (`wget http://127.0.0.1:3000/api/settings`) liefert `401 Unauthorized` wie erwartet.
- Bewertung: Endpoint ist funktional erreichbar; der Host-`curl`-Fehler ist ein Umgebungs-/Runner-Artefakt und kein App-Fehler.

## Automatisierter Smoke-Runner (2026-02-20, 18:30 UTC)

- Neu: `scripts/smoke-test.sh`
  - `npm run smoke` -> Docker/API-Smoke
  - `npm run smoke:full` -> `test + lint + build` plus PDF-Renderer-Check
- Laufstatus:
  - `npm run smoke` -> erfolgreich.
  - `npm run smoke:full` -> erfolgreich.
