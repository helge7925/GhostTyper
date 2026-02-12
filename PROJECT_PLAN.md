# GhostTyper Projektplan

Stand: 2026-02-12

## 1. Zielbild

GhostTyper ist eine sichere, selbstgehostete KI-Webapp für:
- Audio-Transkription
- OCR
- Analyse/Übersetzung
- Editor-zentrierte Nachbearbeitung inkl. PDF/DOCX

## 2. Ist-Stack

| Bereich | Technologie |
|---|---|
| Frontend | Next.js 13 (Pages Router), React 18, Tailwind |
| Backend | Next.js API Routes |
| Auth | NextAuth Credentials + JWT |
| Datenbank | PostgreSQL 16 |
| Deployment | Docker Compose + Traefik |

## 3. Status (kompakt)

- Kernprodukt (Audio/OCR/Analyse/Editor/Export): **abgeschlossen**
- Security-Hardening (internes Review 2026-02-11): **abgeschlossen**
- Externes Review (Kollegenreview 2026-02-12): **P0-P3 abgeschlossen**
- Qualitätssicherung: `npm run lint` **ohne Warnungen/Fehler**

Details:
- Internes Review: `docs/code-review-hardening-2026-02-11.md`
- Externes Review: `docs/external-review-2026-02-12.md`
- P0-P3 Umsetzung: `docs/code-review-priorities-p0-p3-2026-02-12.md`
- Release Notes: `docs/release-notes-2026-02-12.md`

## 4. Prioritätenstatus P0-P3 (externes Review)

| Priorität | Status | Kurzbeschreibung |
|---|---|---|
| P0 | erledigt | Kritische Security-/Validierungspunkte geschlossen |
| P1 | erledigt | Duplikate reduziert, Wartbarkeit verbessert |
| P2 | erledigt | Queue/Worker + Observability-Basis umgesetzt |
| P3 | erledigt | PDF-Paginierung + Mikro-UX verfeinert |

## 5. Nächste Schritte (ab P4)

1. Externe Queue-Infrastruktur für horizontale Skalierung prüfen (z. B. Redis/BullMQ).
2. Observability-Export in zentrale Plattform (z. B. Loki/ELK/Prometheus) ergänzen.
3. CI-Pipeline um Build + E2E-Regressionsläufe erweitern.

## 6. Betriebs-Shortlist nach Update

1. Container neu starten:
```bash
docker compose -f config/docker-compose.dev.yml up --build -d
```
2. DB-Init/Migrationen ausführen:
```bash
curl -X POST http://localhost:3000/api/db-init -H "x-init-secret: dev-db-init-secret"
```
3. Für serverseitigen PDF-Export Chromium/Chrome auf dem Server installieren und Pfad fix setzen:
```bash
export PDF_CHROMIUM_PATH="/usr/bin/chromium"
# alternativ je nach Distribution z. B. /usr/bin/chromium-browser oder /usr/bin/google-chrome
```

Weitere Betriebsdetails: `README.md`, `docs/testing.md`.
