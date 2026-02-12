# GhostTyper VPS Deployment Plan

Stand: 2026-02-12  
Basis: `umgebungsanalyse.md` + `config/docker-compose.prod.yml`

## Zielbild (für den bestehenden VPS)

- Reverse-Proxy/HTTPS über bestehendes Traefik-Netzwerk `web`.
- GhostTyper läuft als eigener Stack mit:
  - `transkription-webapp`
  - `transkription-db` (isoliert im internen Docker-Netzwerk).
- Keine DB-Portfreigabe nach außen.

## 0) Preflight (einmalig vor Deployment)

1. Speicherplatz bereinigen (laut Umgebungsanalyse kritisch):
```bash
docker system df
docker image prune -a
docker volume prune
```
2. Externes Netzwerk prüfen:
```bash
docker network ls | grep -w web
```
3. DNS prüfen: `transkription.<domain>` zeigt auf VPS.

## 1) Secrets und `.env` vorbereiten

Im Projektroot auf dem VPS eine `.env` anlegen (nicht committen):

```env
DOMAIN=transkription.example.de

DB_USER=transkription
DB_PASSWORD=<starkes-passwort>
DB_NAME=transkription

NEXTAUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=https://transkription.example.de
DB_INIT_SECRET=<separater-secret-fuer-db-init>
SETTINGS_ENCRYPTION_KEY=<separater-secret-fuer-settings>
ENABLE_DB_INIT_API=true

MISTRAL_API_KEY=<mistral-key>

RATE_LIMIT_STORE=db
RATE_LIMIT_TRUST_PROXY=false
PDF_CHROMIUM_NO_SANDBOX=false
```

## 2) Erstdeployment

```bash
docker compose -f config/docker-compose.prod.yml up --build -d
```

## 3) Datenbank initialisieren (nur initial/bei Schema-Updates)

```bash
curl -X POST "https://transkription.example.de/api/db-init" \
  -H "x-init-secret: <DB_INIT_SECRET>"
```

Danach Sicherheits-Härtung:
1. `ENABLE_DB_INIT_API=false` in `.env`
2. Stack neu laden:
```bash
docker compose -f config/docker-compose.prod.yml up -d
```

## 4) Admin-Account und Smoke-Checks

Admin anlegen:
```bash
docker exec -it transkription-webapp npm run seed-admin
```

Checks:
```bash
curl -I "https://transkription.example.de"
curl "https://transkription.example.de/api/health"
docker compose -f config/docker-compose.prod.yml ps
```

## 5) Update-Plan (laufender Betrieb)

1. Backup (DB + Uploads).
2. `git pull`
3. `docker compose -f config/docker-compose.prod.yml up --build -d`
4. Healthcheck + Login + Upload-Test.
5. Bei Fehlern: auf vorherigen Git-Commit zurück und erneut deployen.

## 6) Backup/Recovery (Mindeststandard)

- Zu sichern:
  - Volume `transkription-db-data`
  - Volume `transkription-uploads`
- Frequenz: täglich inkrementell, wöchentlich Vollbackup.
- Restore regelmäßig testweise in separater Umgebung prüfen.

## 7) Betriebshinweise für diese VPS-Umgebung

- Watchtower nicht blind auf diesen Stack anwenden; kontrollierte Updates bevorzugen.
- Speicher-Monitoring aktiv halten (Root-Partition war bereits >90% belegt).
- Traefik-Logs und App-Logs (`LOG_FORMAT=json`) zentral sammeln.

## Referenzen

- Umgebungsdetails: `umgebungsanalyse.md`
- Compose Prod: `../config/docker-compose.prod.yml`
- Betriebs- und Testchecks: `testing.md`
