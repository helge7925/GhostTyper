# Release Notes - 2026-02-12

Version: Unreleased Snapshot (P0-P3 Abschluss)

## Nachtrag (seit letzter Doku)

- PDF-Export im Editor robuster gemacht: Export-Tab wird direkt beim Klick geöffnet, Ergebnis wird in denselben Tab geschrieben; Browser-Fallback nutzt denselben Tab und fällt bei Popup-Block auf `window.print()` zurück.
- Editor-Topbar wieder auf direkte Aktionen umgestellt: `DOCX exportieren`, `Übersetzen`, `Text kopieren` und `Kopfbereich` sind wieder sichtbar neben `PDF exportieren`; das kompakte `Mehr`-Menü wurde entfernt.
- Fokusmodus konsequent reduziert: im Fokusmodus werden nur noch `Hell`, `Dunkel` und `Fokus aus` angezeigt.
- Kontrast-Fix für Fokus-Preset-Umschalter: `Dunkel` ist im hellen Fokusmodus wieder klar lesbar.
- Settings-UX für Vorlagen verbessert:
  - Neue Analyse-Vorlagen starten mit leerem Namen statt festem Platzhalter.
  - Speichern prüft jetzt Name und Prompt explizit.
  - KI-Generator setzt bei neuen Vorlagen optional einen Namensvorschlag aus dem Zieltext.
- Einstellungsbereich umbenannt: Tab `Analyse` sowie Überschrift `Analyse-Vorlagen` heißen jetzt `Verarbeitungstemplates`.
- Label-Bug im Editor-Fallback behoben: keine fehlerhafte pauschale `ae/oe/ue`-Umwandlung mehr (z. B. `aktuelle_themen` bleibt korrekt als `Aktuelle Themen`).
- Historie-Seite (`/transcriptions`) responsive korrigiert: kein horizontaler Overflow mehr auf iPad Pro 11 (Landscape).
- Mobile-/Tablet-Smoke-Tests (authentifiziert) durchgeführt und Screenshots abgelegt unter `docs/mobile-smoke/2026-02-12-auth`.

## Highlights

- P0 bis P3 aus der priorisierten Code-Review vollständig umgesetzt.
- Hintergrundverarbeitung auf Queue/Worker-Fluss erweitert (`pending -> queued -> processing`).
- Manuelle KI-Analyse vom API-Request entkoppelt (asynchroner Job-Runner).
- Observability-Basis ergänzt (`GET /api/health`, `GET /api/admin/observability`).
- PDF-Renderer für lange Dokumente stabilisiert (Witwen/Waisen, Heading-/Block-Umbruchschutz).
- Editor-UX vereinfacht (klare Primäraktionen, Sekundäraktionen wieder direkt sichtbar).

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
- Editor-Topbar priorisiert `Speichern` und `PDF exportieren`; weitere Aktionen sind wieder direkt neben dem PDF-Button verfügbar.
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
