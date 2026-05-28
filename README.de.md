<div align="center">
  <img src="public/logo.png" alt="GhostTyper" width="96" height="96" />
  <h1>GhostTyper</h1>
  <p><strong>Self-hosted Plattform für Transkription, OCR und KI-Analyse.</strong></p>
  <p>
    <a href="#schnellstart">Schnellstart</a> ·
    <a href="#funktionen">Funktionen</a> ·
    <a href="#architektur">Architektur</a> ·
    <a href="docs/README.md">Dokumentation</a> ·
    <a href="CHANGELOG.md">Changelog</a>
  </p>
  <p>
    <a href="README.md">English</a> · <strong>Deutsch</strong>
  </p>

  <p>
    <img alt="Version" src="https://img.shields.io/badge/version-0.4.0-orange" />
    <img alt="Stack" src="https://img.shields.io/badge/Next.js-13-black" />
    <img alt="Node" src="https://img.shields.io/badge/Node-18%2B-success" />
    <img alt="Postgres" src="https://img.shields.io/badge/Postgres-16-blue" />
    <img alt="Tests" src="https://img.shields.io/badge/tests-106%20passing-success" />
    <img alt="License" src="https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue" />
  </p>
</div>

<p align="center">
  <img src="docs/screenshots/02-dashboard.png" alt="GhostTyper Dashboard nach Login" width="100%" />
</p>

GhostTyper bündelt Audio-Transkription, OCR, KI-Zusammenfassungen,
strukturierte Datenextraktion und Live-Meeting-Aufzeichnung in einer
selbst gehosteten Anwendung. Mehrere Workspaces, rollenbasierte
Berechtigungen, verschlüsselte API-Keys und ein vollständiger
Audit-Trail sind Teil der Basis.

<details>
<summary>Weitere Screenshots</summary>

<p align="center"><img src="docs/screenshots/01-login.png" alt="Login-Seite" width="49%" /> <img src="docs/screenshots/07-remote-meeting.png" alt="Remote-Meeting Modal" width="49%" /></p>

</details>

---

## Funktionen

- **Audio-Transkription** mit Sprechertrennung; Direktaufnahme oder
  Datei-Upload.
- **Remote-Meeting-Bot** für Google Meet, Microsoft Teams und Zoom via
  [Vexa Lite](https://github.com/Vexa-ai/vexa) — Live-Transkript fließt
  in den gleichen Editor. Ein Community-Fork
  ([helge7925/vexa](https://github.com/helge7925/vexa), Branch
  `feat/nextcloud-talk-adapter`) ergänzt Nextcloud Talk als vierte
  Plattform; aktivierbar via `VEXA_LITE_IMAGE`-Override.
- **OCR** für PDFs und Bilder.
- **KI-Analyse**: Zusammenfassungen, freie Prompts, Vorlagen,
  Übersetzungen.
- **Datentabellen**: Strukturierte Extraktion aus Audio, Text oder
  Dokumenten; Excel-Export.
- **Multi-Workspace**: Org-skopierte Daten, Rollen `owner`/`admin`/
  `member`/`viewer`/`auditor`, Audit-Log.
- **Kosten-Tracking**: Monatliche Aufschlüsselung pro Provider,
  Operation und Mitglied.
- **Provider-Management**: Mistral und Vexa zentral pro Workspace
  verwaltbar; Keys AES-256-GCM verschlüsselt.

## Tech-Stack

| Schicht  | Technologie                                                      |
| -------- | ---------------------------------------------------------------- |
| Frontend | Next.js 13 (Pages Router), React 18, Tailwind, Radix, Zustand    |
| Backend  | Next.js API Routes, NextAuth, PostgreSQL 16 (`pg`)               |
| AI       | Mistral (Chat / OCR / Voxtral batch + live), Vexa Lite           |
| Infra    | Docker Compose, Traefik (optional), AES-256-GCM (`lib/secrets.js`) |
| CI       | GitHub Actions: CodeQL, Security-Gates, Smoke                    |

## Architektur

```
┌─────────────────────────┐    ┌──────────────────────────┐
│ GhostTyper Webapp       │    │ Postgres 16              │
│ Next.js 13 + Worker     │◄──►│ Workspaces · Audit · Logs│
└──┬──────────────┬───────┘    └──────────────────────────┘
   │              │
   │ REST/SSE     │ Webhook + Bridge
   ▼              ▼
┌────────┐   ┌──────────────────┐    ┌────────────────────┐
│ Mistral│◄──┤ Vexa Lite        │───►│ Mistral Voxtral    │
│ API    │   │ (Bot-Container)  │    │ (über Voxtral-     │
│ (Batch)│   │                  │    │  Bridge-Translator)│
└────────┘   └──────────────────┘    └────────────────────┘
```

Datenfluss-Details: [`docs/architecture.md`](docs/architecture.md).
Vexa-Integration: [`docs/vexa-integration.md`](docs/vexa-integration.md).

## Systemanforderungen

| Profil                  | RAM   | CPU      | Disk    | Hinweis                              |
| ----------------------- | ----- | -------- | ------- | ------------------------------------ |
| Minimum (ohne Vexa)     | 2 GB  | 1 vCPU   | 10 GB   | nur Webapp + Postgres                |
| Mit `vexa`-Profil       | 4 GB  | 2 vCPU   | 20 GB   | + vexa-lite (2 GB) + bridge (256 MB) |
| 5–10 aktive Nutzer      | 8 GB  | 4 vCPU   | 40 GB SSD | komfortabel für tägliche Team-Nutzung |

Speech-to-Text-Inferenz läuft bei Mistral (Voxtral) — sowohl für Batch-
Uploads als auch für den Vexa-Live-Pfad, **GPU auf dem Host ist nicht
nötig**. Browser-Bots innerhalb von Vexa belegen pro paralleles
Live-Meeting kurzzeitig zusätzlich ~1 GB RAM. Das `vexa-lite`-Image ist
`linux/amd64`-only — auf Apple Silicon läuft es per Emulation und ist
spürbar langsamer.

## Schnellstart

Voraussetzungen: Docker + Docker Compose v2, ein Mistral-API-Key.

```bash
git clone https://github.com/helge7925/transkription_webapp.git
cd transkription_webapp
cp .env.example .env
# Secrets in .env mit `openssl rand -hex 32` erzeugen,
# DB_USER / DB_PASSWORD / DB_NAME / DOMAIN setzen.

docker compose -f config/docker-compose.prod.yml --env-file .env up -d --build
```

Schema initialisieren (einmalig):

```bash
docker compose -f config/docker-compose.prod.yml --env-file .env \
  exec transkription-webapp \
  wget -qO- --post-data='' \
  --header "X-Init-Secret: $(grep ^DB_INIT_SECRET .env | cut -d= -f2)" \
  http://127.0.0.1:3000/api/db-init
```

Admin anlegen:

```bash
npm run seed-admin
```

App ist dann unter `http://localhost:3000` erreichbar (oder hinter
Traefik auf `https://${DOMAIN}`).

### Mit Remote-Meeting-Bot

Vexa Lite und die Transkriptions-Bridge sind als optionales Compose-Profile
vorbereitet. Standard-Audiopfad ist **Mistral Voxtral (Paris, EU)**, damit
biometrische Meeting-Audio-Daten (DSGVO Art. 9) den EU-Raum nicht
verlassen. Der Bridge-Service heißt `voxtral-bridge` (proxied zu Mistral
Voxtral; der alte `FIREWORKS_API_KEY`-Env-Wert bleibt als Fallback
erhalten) — siehe „DSGVO-konformes Setup" unten.

```bash
COMPOSE_PROFILES=vexa
# EU-Default — empfohlen
VEXA_TRANSCRIPTION_URL=https://api.mistral.ai/v1/audio/transcriptions
VEXA_TRANSCRIPTION_TOKEN=$MISTRAL_API_KEY
VEXA_ADMIN_API_TOKEN=$(openssl rand -hex 32)
BRIDGE_SHARED_SECRET=$(openssl rand -hex 32)
```

Hochfahren mit `--profile vexa`. Operator-Guide:
[`docs/vexa-integration.md`](docs/vexa-integration.md). Vollständiger
Datenfluss-Review und SCC/TIA-Implikationen bei Provider-Wechsel:
[`docs/gdpr-setup.md`](docs/gdpr-setup.md).

## Konfiguration

Pro Workspace verwaltet der Admin in
**Settings → Workspace verwalten**:

- API-Keys & Integrationen (Mistral, Vexa)
- Mitglieder & Rollen (inkl. per-Member-Kostenlimits)
- Aufbewahrungsfristen
- Nutzung & Kosten-Dashboard
- Audit-Log

Vollständige ENV-Referenz: [`.env.example`](.env.example).

## Tests & Qualität

| Befehl                   | Zweck                                                |
| ------------------------ | ---------------------------------------------------- |
| `npm test`               | 106 Unit-Tests (Tabellenlogik, Vexa-Mapping, Webhooks, Satz-Buffering, Permissions, Secrets, …) |
| `npm run lint`           | ESLint mit Next.js-Regelsatz                         |
| `npm run smoke`          | Docker/API-Smoke-Test                                |
| `npm run smoke:full`     | Smoke + Tests + Lint + Build + PDF-Renderer          |
| `npm run retention:apply`| Aufbewahrungs-Policy anwenden                        |

CI-Pipelines: CodeQL (Security), Security-Gates (Secrets-Scan), Smoke
(`/api/health` + Build). Siehe [`.github/workflows`](.github/workflows).

## Dokumentation

- [`docs/README.md`](docs/README.md) — Übersicht aller Dokumente
- [`docs/architecture.md`](docs/architecture.md) — Datenfluss + Komponenten
- [`docs/vexa-integration.md`](docs/vexa-integration.md) — Operator-Guide
  für Remote-Meeting
- [`docs/api-specification.md`](docs/api-specification.md) — REST-API-Referenz
- [`docs/vps-deployment-guide.md`](docs/vps-deployment-guide.md) —
  Produktiv-Deployment
- [`docs/cybersecurity-audit-2026-02-21.md`](docs/cybersecurity-audit-2026-02-21.md)
  — letzter Sicherheits-Audit

## Beitragen

Issues und Pull-Requests sind willkommen — siehe [`SECURITY.md`](SECURITY.md)
für sicherheitsrelevante Meldungen und die Templates unter
[`.github/`](.github/) für strukturierte Beiträge.

## Lizenz

[PolyForm Noncommercial License 1.0.0](LICENSE). Erlaubt private,
akademische, gemeinnützige und Hobby-Nutzung sowie Modifikation und
Weitergabe, solange keine kommerzielle Verwendung vorliegt. Für
kommerzielle Nutzung — auch intern in einem gewinnorientierten
Unternehmen — ist eine separate Lizenz erforderlich; bitte über den
Issue-Tracker oder direkt beim Copyright-Inhaber anfragen.
