# Docker-Setup

GhostTyper läuft als Stack aus Docker-Containern. Zwei Compose-Dateien in
`config/`:

- `docker-compose.prod.yml` — Production. Webapp + Postgres als Pflicht-
  Services, Vexa-Lite + Voxtral-Bridge als optionale Services hinter
  dem `vexa`-Profile. Traefik-Labels für TLS-Routing sind vorbereitet,
  greifen aber erst, wenn ein Traefik im selben `web`-Netzwerk läuft.
- `docker-compose.dev.yml` — Lokale Entwicklung. Volume-Mount des
  Quelltextes, `npm run dev` mit Hot-Reload statt Standalone-Build.
- `docker-compose.orbstack.yml` — localhost-only Override für einen lokalen
  Production-Smoke-Test ohne Traefik.

Quelle für die definitive Konfiguration sind immer die YAML-Dateien
selbst — dieses Dokument fasst nur den Stand für Operatoren zusammen.

## Container-Übersicht (Production-Stack)

| Service | Container-Name | Image | Pflicht | Port |
|---|---|---|---|---|
| `transkription-webapp` | `transkription-webapp` | gebaut aus `Dockerfile` (Tag `transkription-webapp:prod`) | ja | intern :3000; mit OrbStack-Override `127.0.0.1:${WEBAPP_HOST_PORT:-3000}:3000` |
| `transkription-db` | `transkription-db` | `postgres:16-alpine` | ja | intern :5432 |
| `vexa-lite` | `transkription-vexa-lite` | `${VEXA_LITE_IMAGE:-vexaai/vexa-lite:0.10.0-260430-1701}` | optional, Profile `vexa` | intern :8056, Dashboard exposed auf `127.0.0.1:${VEXA_DASHBOARD_HOST_PORT:-3300}:3000` |
| `vexa-db-init` | `transkription-vexa-db-init` | `postgres:16-alpine` | optional, Profile `vexa` | — (One-shot) |
| `voxtral-bridge` | `transkription-voxtral-bridge` | gebaut aus `services/voxtral-bridge/` (Tag `voxtral-bridge:prod`) | optional, Profile `vexa` | intern :8080 |

`voxtral-bridge` übersetzt Vexas Multipart-Audio in den JSON-Vertrag der
OpenRouter-Transkriptions-API. Schlüssel und Live-Modell werden zur Laufzeit
aus der Organisationskonfiguration der Webapp geladen.

## Netzwerke

Zwei Docker-Netzwerke:

- **`internal`** (compose-eigen) — Service-zu-Service-Verkehr. Alle
  Container sind hier drin; nichts davon wird ohne explizite
  Port-Map nach außen exponiert.
- **`web`** (extern) — nur die Webapp hängt zusätzlich hier drin, damit
  ein Traefik im selben `web`-Netz HTTPS-Routing übernehmen kann. Wenn
  kein Traefik läuft, ist diese Verbindung harmlos. Das Netz muss vor
  dem ersten `compose up` einmalig angelegt werden:
  ```bash
  docker network create web
  ```

## Schnellstart Production

```bash
cp .env.example .env
# Secrets in .env ausfüllen — siehe Abschnitt unten.

docker compose -f config/docker-compose.prod.yml \
  --env-file .env up -d --build
```

Für den lokalen Production-Smoke-Test mit OrbStack wird zusätzlich der
localhost-only Override geladen:

```bash
docker compose -f config/docker-compose.prod.yml \
  -f config/docker-compose.orbstack.yml \
  --env-file .env up -d --build
```

Der Override bindet die Webapp an `127.0.0.1:3000` und PostgreSQL für
wegwerfbare DB-Tests an `127.0.0.1:5433`. Beide Ports lassen sich mit
`WEBAPP_HOST_PORT` beziehungsweise `DB_HOST_PORT` ändern.

Nach erstem `up`:
1. Schema-Init einmalig auslösen:
   ```bash
   docker compose -f config/docker-compose.prod.yml --env-file .env \
     exec transkription-webapp \
     wget -qO- --post-data='' \
       --header "X-Init-Secret: $(grep ^DB_INIT_SECRET .env | cut -d= -f2)" \
       http://127.0.0.1:3000/api/db-init
   ```
2. Ersten Admin-Account anlegen:
   ```bash
   npm run seed-admin
   ```
3. Mit dem OrbStack-Override: Browser auf
   `http://localhost:${WEBAPP_HOST_PORT:-3000}`; andernfalls hinter Traefik
   auf `https://${DOMAIN}`.

## Vexa-Profile aktivieren (Remote-Meeting)

Standardmäßig läuft GhostTyper ohne Vexa-Stack. Zum Aktivieren:

```bash
# .env zusätzlich:
COMPOSE_PROFILES=vexa
OPENROUTER_API_KEY=…                  # optionaler Operator-Fallback
VEXA_ADMIN_API_TOKEN=$(openssl rand -hex 32)
BRIDGE_SHARED_SECRET=$(openssl rand -hex 32)
RECONCILE_API_SECRET=$(openssl rand -hex 32)

# Dann re-up
docker compose -f config/docker-compose.prod.yml --env-file .env up -d
```

Details + Architekturdiagramm: [`docs/vexa-integration.md`](vexa-integration.md).

## ENV-Variablen

Vollständige Liste mit Defaults: [`.env.example`](../.env.example). Pflicht-
Werte für Production:

| Variable | Beschreibung |
|---|---|
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Postgres-Credentials |
| `NEXTAUTH_SECRET` | NextAuth-Session-Sigil; `openssl rand -hex 32` |
| `DB_INIT_SECRET` | Header-Geheimnis für `/api/db-init` |
| `SETTINGS_ENCRYPTION_KEY` | AES-256-GCM-Master-Key für Provider-Keys |
| `DOMAIN` | Public-Hostname für Traefik-TLS (kann leer bleiben für reines Localhost) |

Optional (je nach Setup):

| Variable | Default | Zweck |
|---|---|---|
| `WEBAPP_HOST_PORT` | `3000` | Host-Port für die Webapp |
| `VEXA_LITE_IMAGE` | upstream Vexa-AI | Override mit Nextcloud-Talk-Fork (`ghcr.io/helge7925/vexa-bot-talk:<tag>`) |
| `VEXA_DASHBOARD_HOST_PORT` | `3300` | Host-Port für Vexas Operator-Dashboard (Bind 127.0.0.1) |
| `OPENROUTER_API_KEY` | leer | Operator-Fallback, falls kein Organisationsschlüssel gesetzt ist |
| `OUTBOUND_ALLOWED_HOSTS` | `openrouter.ai` | Exakte Egress-Allowlist für KI-Aufrufe |
| `AUTH_CREDENTIALS_ENABLED` | `false` | Email/Password-Login zusätzlich zu OIDC |
| `OIDC_*` | leer | Single-Sign-On gegen einen externen IdP |

## Image-Build-Details

`Dockerfile` macht einen 3-stufigen Build:

1. `deps` — `npm ci`
2. `builder` — `next build`, erzeugt das `.next/standalone`-Bundle
3. `runner` — kopiert `.next/standalone` + `.next/static` + `public`,
   installiert ffmpeg + chromium + nss + freetype + harfbuzz + ttf-freefont
   (für PDF-Export und Audio-Konvertierung), läuft als nicht-Root-User
   `nextjs:1001`, exposed Port 3000, hat einen Health-Check gegen
   `/api/health`.

Erstbau dauert je nach Mac/VM ~10-25 Min (Chromium-Install ist der
Engpass). Folgerebuilds nutzen Layer-Cache: nur Stage 2 läuft frisch,
wenn sich der Quelltext geändert hat — typisch 1-3 Min.

## Probleme

### Port `3000` schon belegt
```bash
# .env:
WEBAPP_HOST_PORT=3100
```
Dann `compose down && compose up -d`.

### Build-Cache zu groß
Nach mehreren Rebuilds kann `docker system df` 20+ GB Build-Cache zeigen.
```bash
docker buildx prune -f
```

### Vexa-Container restartet endlos
Health-Check schlägt fehl. Logs ansehen:
```bash
docker logs transkription-vexa-lite --tail 100
```
Häufige Ursachen: `DATABASE_URL` falsch, `vexa-db-init` hat noch nicht
fertig (kann beim allerersten Start passieren — einfach noch 30 s warten).

### `web`-Netzwerk fehlt
```
ERROR: Network web declared as external, but could not be found.
```
Einmalig anlegen:
```bash
docker network create web
```

## Verwandte Docs

- [`vexa-integration.md`](vexa-integration.md) — Vexa-Stack im Detail
- [`vps-deployment-guide.md`](vps-deployment-guide.md) — Production-Deploy
- [`api-specification.md`](api-specification.md) — REST-Endpoint-Referenz
