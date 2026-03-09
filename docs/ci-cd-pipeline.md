# CI/CD Pipeline

Stand: 2026-02-20

Dieses Dokument beschreibt den aktuellen CI/CD-Status und eine empfohlene Zielpipeline.

## 1. Aktueller Stand

- Es gibt eine aktive GitHub-Actions-Pipeline: `.github/workflows/smoke.yml`.
- Die Pipeline läuft bei `push` und `pull_request`.
- Der Job führt aus:
  1. `npm ci`
  2. `npm run smoke:full` (inkl. `test`, `lint`, `build`, Docker/API-Smoke, PDF-Renderer-Check)
- Bei Fehlern werden Docker-Logs ausgegeben; anschließend wird der Compose-Stack bereinigt.

## 2. Zielbild der Pipeline

Mindestpipeline pro Pull Request:
1. Install (`npm ci`)
2. Lint (`npm run lint`) ohne Interaktion
3. Build (`npm run build`)
4. Optionale API-/Integrationstests

Deploymentpipeline (main/release):
1. Image bauen
2. Container starten/aktualisieren
3. DB-Init/Migration ausführen
4. Smoke-Checks

## 3. Empfohlene CI-Jobs

### 3.1 `validate`
- `npm ci`
- `npm run build`
- optional: `npm run lint` sobald ESLint finalisiert

### 3.2 `security-check`
- Dependency-Audit (abhängig von Registry-Zugriff)
- Prüfung auf erforderliche ENV-Variablen in Deployment-Umgebung

### 3.3 `smoke-dev`
- Docker Compose Dev hochfahren
- `/api/db-init` ausführen
- kurze API-Smokechecks (`/api/transcriptions`, Login-Flow, Upload-Route)

## 4. Deployment-Hinweise

Für jede produktionsnahe Auslieferung:
1. Container neu bauen/starten
2. DB-Init/Migrationen ausführen
3. ggf. API-Key-Migration ausführen
4. Verifikation per SQL-Checks

Beispiel:
```bash
docker compose -f config/docker-compose.dev.yml up --build -d
curl -X POST http://localhost:3000/api/db-init -H "x-init-secret: dev-db-init-secret"
```

## 5. Pipeline-Risiken und Maßnahmen

- Risiko: unvollständige Lint-Integration
  - Maßnahme: feste ESLint-Konfiguration committen, interaktive Abfrage eliminieren
- Risiko: migrationsabhängige Runtime-Fehler
  - Maßnahme: DB-Init und Verifikationsqueries als festen Deployment-Schritt aufnehmen
- Risiko: Secrets/ENV fehlen
  - Maßnahme: Preflight-Checks auf `NEXTAUTH_SECRET`, `DB_INIT_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `DATABASE_URL`

## 6. Nächste Schritte

1. Branch Protection aktivieren und Workflow `Smoke CI` als Required Check markieren.
2. Optional separaten Schnell-Job (`npm test` + `npm run lint`) für kürzere PR-Feedbackzeiten ergänzen.
3. Optional Nightly-Job mit zusätzlichen End-to-End-Tests ergänzen.

## 7. Referenzen

- Projektplan: `../PROJECT_PLAN.md`
- Testing: `testing.md`
- Security/Hardening: `code-review-hardening-2026-02-11.md`
- Deployment: `vps-deployment-guide.md`
