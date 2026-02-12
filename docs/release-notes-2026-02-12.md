# Release Notes - 2026-02-12

Version: Unreleased Snapshot (P0-P3 Abschluss)

## Highlights

- P0 bis P3 aus der priorisierten Code-Review vollständig umgesetzt.
- Hintergrundverarbeitung auf Queue/Worker-Fluss erweitert (`pending -> queued -> processing`).
- Manuelle KI-Analyse vom API-Request entkoppelt (asynchroner Job-Runner).
- Observability-Basis ergänzt (`GET /api/health`, `GET /api/admin/observability`).
- PDF-Renderer für lange Dokumente stabilisiert (Witwen/Waisen, Heading-/Block-Umbruchschutz).
- Editor-UX vereinfacht (klare Primäraktionen, Sekundäres im `Mehr`-Menü).

## Security & Stabilität

- Editor-Sanitizing bei laufenden Edits/Paste gehärtet.
- Harte Input-Limits für Dokument-Speichern (`title`, `text`, `documentHtml`) ergänzt.
- Secret-Härtung: kein Fallback mehr von `SETTINGS_ENCRYPTION_KEY` auf `NEXTAUTH_SECRET`.
- Admin-User-Update transaktional gemacht (konsistente Writes über User/Settings).
- Duplizierte Kernlogik zentralisiert (Analysis-Cleaning, Template-Auflösung, Stale-Recovery).
- AudioRecorder-Cleanup stabilisiert (saubere Blob-URL-Freigabe, weniger Race-Potenzial).

## Produkt & UX

- `queued`-Status transparent in Statusbadges, Live-Status und Workflow-Kommunikation integriert.
- Queue-Startfehler werden sichtbar kommuniziert, manuelle Neustartpfade bleiben verfügbar.
- Editor-Topbar priorisiert jetzt `Speichern` und `PDF exportieren`; weitere Aktionen in kompaktem Menü.
- PDF-Ausgabe zeigt stabilere Seitenumbrüche in Listen, Tabellen und bei Überschriften.

## Betrieb & Developer Experience

- Strukturierte Logs und Laufzeitmetriken zentralisiert (`lib/observability.js`).
- Neue Worker-/Logging-Optionen über Env-Variablen:
  - `TRANSCRIPTION_WORKER_CONCURRENCY`
  - `TRANSCRIPTION_WORKER_SCAN_INTERVAL_MS`
  - `TRANSCRIPTION_WORKER_SCAN_BATCH`
  - `LOG_FORMAT`
  - `LOG_LEVEL`
- Lint-Status: `npm run lint` ohne Warnungen/Fehler.

## Wichtige Hinweise

- Nach Deployment: Container neu starten und `POST /api/db-init` ausführen.
- In restriktiven Sandbox-Umgebungen kann `npm run build` bei `Collecting page data` mit `EPERM listen 0.0.0.0` abbrechen, obwohl die Kompilierung erfolgreich ist.

## Referenzen

- Externes Review: `external-review-2026-02-12.md`
- Detailliertes P0-P3-Protokoll: `code-review-priorities-p0-p3-2026-02-12.md`
- Projektplan: `../PROJECT_PLAN.md`
- Changelog: `../CHANGELOG.md`
