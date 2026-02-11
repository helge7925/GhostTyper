# GhostTyper Dokumentation

Stand: 2026-02-11

Diese Seite ist der Einstieg in die Projektdokumentation.

## Schnellnavigation

### Betrieb & Setup
- `../README.md`: Quickstart, Migration, wichtigste Befehle
- `docker-setup.md`: Docker-Setup und Laufzeitumgebung
- `vps-deployment-guide.md`: Deployment auf VPS/Traefik
- `docker-troubleshooting.md`: Docker-spezifische Fehlerbilder

### Sicherheit & Stabilität
- `code-review-hardening-2026-02-11.md`: umfassende Code-Review, Security-Härtung, Migrations-Checkliste
- `authentication.md`: Authentifizierungskonzept
- `troubleshooting-auth.md`: Auth-Fehlerbilder und Lösungen

### Funktionen & Produktstand
- `features-and-improvements.md`: umgesetzte Features und UX-Verbesserungen
- `ai-integration.md`: Mistral-Integration (Transkription/OCR/Analyse/Übersetzung)
- `audio-upload.md`: Upload-/Audiofluss
- `api-specification.md`: API-Schnittstellen

### Projektführung
- `../PROJECT_PLAN.md`: aktueller Projektplan und Roadmap
- `project-completion.md`: historischer Abschluss-/Abnahmekontext
- `implementation.md`: technische Implementierungsdetails
- `testing.md`: Teststrategie und Prüfabläufe
- `documentation.md`: Meta-Dokumentation

## Neu seit dem Hardening-Block (2026-02-11)

- API-Key-Härtung:
  - verschlüsselte Speicherung in `settings.mistral_api_key_encrypted`
  - Migrationsskript `npm run migrate-api-keys`
- Sicherheitsmaßnahmen:
  - Rate-Limits auf kritischen Endpunkten
  - Modell-Whitelist und härtere Eingabevalidierung
  - getrennte Secrets (`DB_INIT_SECRET`, `SETTINGS_ENCRYPTION_KEY`)
- Betriebsstabilität:
  - atomische Statusübergänge
  - Stale-Job-Recovery
  - robustere Datei-/Pfadbehandlung
- UX-Verbesserungen:
  - einheitliche Statuskarte mit ETA und rotierenden Lade-Texten
  - Live-Status via SSE bei laufenden Transkriptionsjobs (Polling als Fallback)
  - Auto-Weiterleitung nach Upload bei fertigem Ergebnis
  - sichtbare Startfehler bei Warteschlangen-Jobs inkl. manueller Neustart-Aktion
  - Event-Timeline (Verlauf) in der Transkriptionsdetailseite
- Export:
  - serverseitiger PDF-Exportpfad (`/api/export/pdf`) mit Chromium-Rendering
  - fester PDF-Stil (`Soft Business` + `Google Sans Soft`) inkl. direkter Browser-Öffnung
  - optionaler schlanker PDF-Kopfbereich (Titel, Datum, Projekt)
  - Header/Footer-Artefakte im PDF entfernt
- Defaults:
  - Upload-Default-Template konsistent auf `Zusammenfassung` (`generic`) gesetzt

## Empfohlene Lesereihenfolge

1. `../README.md`
2. `../PROJECT_PLAN.md`
3. `code-review-hardening-2026-02-11.md`
4. `features-and-improvements.md`
5. je nach Bedarf: `api-specification.md`, `testing.md`, `vps-deployment-guide.md`

## Betriebshinweis

Wenn nach Codeänderungen neue DB-Strukturen erwartet werden (z. B. `transcription_events`, `mistral_api_key_encrypted`), müssen:
1. Container neu gebaut/gestartet werden.
2. `POST /api/db-init` mit korrekt gesetztem `x-init-secret` ausgeführt werden.
