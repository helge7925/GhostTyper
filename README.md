<div align="center">
  <img src="public/logo.png" alt="GhostTyper" width="96" height="96" />
  <h1>GhostTyper</h1>
  <p><strong>Self-hosted transcription, OCR and AI analysis platform.</strong></p>
  <p>
    <a href="#schnellstart">Quickstart</a> ·
    <a href="#funktionen">Features</a> ·
    <a href="#architektur">Architektur</a> ·
    <a href="docs/README.md">Dokumentation</a> ·
    <a href="CHANGELOG.md">Changelog</a>
  </p>

  <p>
    <img alt="Version" src="https://img.shields.io/badge/version-1.2.0-orange" />
    <img alt="Stack" src="https://img.shields.io/badge/Next.js-13-black" />
    <img alt="Node" src="https://img.shields.io/badge/Node-18%2B-success" />
    <img alt="Postgres" src="https://img.shields.io/badge/Postgres-16-blue" />
    <img alt="Tests" src="https://img.shields.io/badge/tests-60%20passing-success" />
    <img alt="License" src="https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue" />
  </p>
</div>

<p align="center">
  <img src="docs/screenshots/01-login.png" alt="GhostTyper login screen" width="100%" />
</p>

GhostTyper bündelt Audio-Transkription, OCR, KI-Zusammenfassungen, strukturierte Datenextraktion und Live-Meeting-Aufzeichnung in einer self-hosted Anwendung. Mehrere Workspaces, rollenbasierte Berechtigungen, verschlüsselte API-Keys und ein vollständiger Audit-Trail sind Teil der Basis.

---

## Funktionen

- **Audio-Transkription** mit Sprechertrennung; Direktaufnahme oder Datei-Upload.
- **Remote-Meeting-Bot** für Google Meet und Microsoft Teams via [Vexa Lite](https://github.com/Vexa-ai/vexa) — Live-Transkript fließt in den gleichen Editor.
- **OCR** für PDFs und Bilder.
- **KI-Analyse**: Zusammenfassungen, freie Prompts, Vorlagen, Übersetzungen.
- **Datentabellen**: Strukturierte Extraktion aus Audio, Text oder Dokumenten; Excel-Export.
- **Multi-Workspace**: Org-skopierte Daten, Rollen `owner`/`admin`/`member`/`viewer`/`auditor`, Audit-Log.
- **Kosten-Tracking**: Monatliche Aufschlüsselung pro Provider, Operation und Mitglied.
- **Provider-Management**: Mistral, Fireworks Whisper, Vexa zentral pro Workspace verwaltbar; Keys AES-256-GCM verschlüsselt.

## Tech-Stack

| Schicht | Technologie |
| --- | --- |
| Frontend | Next.js 13 (Pages Router), React 18, Tailwind, Radix, Zustand |
| Backend | Next.js API Routes, NextAuth, PostgreSQL 16 (`pg`) |
| AI | Mistral (Chat / OCR / Voxtral), Fireworks Whisper-v3, Vexa Lite |
| Infra | Docker Compose, Traefik (optional), AES-256-GCM (`lib/secrets.js`) |
| CI | GitHub Actions: CodeQL, Security-Gates, Smoke |

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
│ Mistral│   │ Vexa Lite        │───►│ Fireworks Whisper  │
│ API    │   │ (Bot-Container)  │    │ (über fireworks-   │
└────────┘   └──────────────────┘    │  bridge Translator)│
                                     └────────────────────┘
```

Datenfluss-Details: [`docs/architecture.md`](docs/architecture.md). Vexa-Integration: [`docs/vexa-integration.md`](docs/vexa-integration.md).

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

App ist dann unter `http://localhost:3000` erreichbar (oder hinter Traefik
auf `https://${DOMAIN}`).

### Mit Remote-Meeting-Bot

Vexa Lite + Fireworks-Bridge sind als optionales Compose-Profile vorbereitet:

```bash
COMPOSE_PROFILES=vexa
VEXA_TRANSCRIPTION_URL=https://api.fireworks.ai/inference/v1/audio/transcriptions
VEXA_TRANSCRIPTION_TOKEN=fw_…
VEXA_ADMIN_API_TOKEN=$(openssl rand -hex 32)
BRIDGE_SHARED_SECRET=$(openssl rand -hex 32)
```

Dann hochfahren mit `--profile vexa`. Operator-Guide: [`docs/vexa-integration.md`](docs/vexa-integration.md).

## Konfiguration

Pro Workspace verwaltet der Admin in **Settings → Workspace verwalten**:

- API-Keys & Integrationen (Mistral, Fireworks Whisper, Vexa)
- Mitglieder & Rollen (inkl. per-Member-Kostenlimits)
- Aufbewahrungsfristen
- Nutzung & Kosten-Dashboard
- Audit-Log

Detaillierte ENV-Referenz: [`.env.example`](.env.example).

## Tests & Qualität

| Befehl | Zweck |
| --- | --- |
| `npm test` | 60 Unit-Tests (Tabellenlogik, Vexa-Mapping, Webhooks, …) |
| `npm run lint` | ESLint mit Next.js-Regelsatz |
| `npm run smoke` | Docker/API-Smoke-Test |
| `npm run smoke:full` | Smoke + Tests + Lint + Build + PDF-Renderer |
| `npm run retention:apply` | Aufbewahrungs-Policy anwenden |

CI-Pipelines: CodeQL (Security), Security-Gates (Secrets-Scan), Smoke
(`/api/health` + Build). Siehe [`.github/workflows`](.github/workflows).

## Dokumentation

- [`docs/README.md`](docs/README.md) — Übersicht aller Dokumente
- [`docs/architecture.md`](docs/architecture.md) — Datenfluss + Komponenten
- [`docs/vexa-integration.md`](docs/vexa-integration.md) — Operator-Guide für Remote-Meeting
- [`docs/api-specification.md`](docs/api-specification.md) — REST-API-Referenz
- [`docs/vps-deployment-guide.md`](docs/vps-deployment-guide.md) — Produktiv-Deployment
- [`docs/cybersecurity-audit-2026-02-21.md`](docs/cybersecurity-audit-2026-02-21.md) — Letzter Sicherheits-Audit

## Beitragen

Issues und Pull-Requests sind willkommen — siehe [`SECURITY.md`](SECURITY.md)
für sicherheitsrelevante Meldungen und die Templates unter `.github/`.

## Lizenz

[PolyForm Noncommercial License 1.0.0](LICENSE). Erlaubt private,
akademische, gemeinnützige und Hobby-Nutzung sowie Modifikation und
Weitergabe, solange keine kommerzielle Verwendung vorliegt. Für
kommerzielle Nutzung — auch intern in einem gewinnorientierten
Unternehmen — ist eine separate Lizenz erforderlich; bitte über den
Issue-Tracker oder direkt beim Copyright-Inhaber anfragen.
