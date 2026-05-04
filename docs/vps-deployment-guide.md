# GhostTyper VPS Deployment Guide

Stand: 2026-02-12  
Basis: `umgebungsanalyse.md`, `../config/docker-compose.prod.yml`, `../Dockerfile`

## 1) Zielbild

GhostTyper läuft auf dem bestehenden VPS als eigener Docker-Compose-Stack:

1. `transkription-webapp` (Next.js, API, Worker, PDF-Renderer)
2. `transkription-db` (PostgreSQL 16)
3. HTTPS-Routing über bestehendes Traefik-Netzwerk `web`
4. Keine externe DB-Portfreigabe

## 2) Architektur und Annahmen

1. VPS hat bereits Docker + Docker Compose Plugin.
2. Externes Docker-Netzwerk `web` existiert.
3. DNS zeigt auf den VPS (`transkription.<domain>`).
4. Deployment erfolgt aus dem Repository mit `config/docker-compose.prod.yml`.

## 3) Preflight-Checkliste (Pflicht vor Erstdeployment)

1. Speicherplatz prüfen (laut Umgebungsanalyse kritisch):
```bash
df -h /
docker system df
```
2. Falls knapp: bereinigen:
```bash
docker image prune -a
docker volume prune
```
3. Docker/Compose prüfen:
```bash
docker --version
docker compose version
```
4. Traefik-Netzwerk prüfen:
```bash
docker network ls | grep -w web
```
5. DNS prüfen:
```bash
dig +short transkription.example.de
```

## 4) Verzeichnis- und Git-Setup auf dem VPS

```bash
sudo mkdir -p /opt/ghosttyper
sudo chown -R "$USER":"$USER" /opt/ghosttyper
cd /opt/ghosttyper
git clone <REPO_URL> .
git checkout main
```

## 5) `.env` für Produktion erstellen

Im Repo-Root `/opt/ghosttyper/.env`:

```env
DOMAIN=transkription.example.de

DB_USER=transkription
DB_PASSWORD=EXAMPLE_STRONG_DB_PASSWORD
DB_NAME=transkription

# Generate fresh values for the three secrets below with: openssl rand -base64 32
NEXTAUTH_SECRET=EXAMPLE_NEXTAUTH_SECRET
NEXTAUTH_URL=https://transkription.example.de
DB_INIT_SECRET=EXAMPLE_DB_INIT_SECRET
SETTINGS_ENCRYPTION_KEY=EXAMPLE_SETTINGS_ENCRYPTION_KEY
ENABLE_DB_INIT_API=true

# Optional: Uploads auf Storage Box auslagern (statt Named Volume)
# UPLOADS_PATH=/mnt/storage-box/ghosttyper/uploads

# Hinweis: MISTRAL_API_KEY wird über die Admin-Oberfläche konfiguriert,
# nicht mehr über Environment-Variablen.

NEXT_PUBLIC_API_URL=/api
RATE_LIMIT_STORE=db
RATE_LIMIT_TRUST_PROXY=false
LOG_FORMAT=json
LOG_LEVEL=info

PDF_CHROMIUM_PATH=/usr/bin/chromium-browser
PDF_CHROMIUM_NO_SANDBOX=false
PDF_EXPORT_MAX_CONCURRENCY=2
PDF_EXPORT_QUEUE_TIMEOUT_MS=5000
```

Secret-Erzeugung:
```bash
openssl rand -base64 32
```

## 6) Hinweis zu Chromium/PDF-Renderer

Der serverseitige PDF-Export braucht ein ausführbares Chromium/Chrome im App-Container.

1. Im Docker-Deployment ist Chromium bereits im Image enthalten (`Dockerfile`).
2. Trotzdem muss `PDF_CHROMIUM_PATH` korrekt sein.
3. Verifizieren nach dem Deploy:
```bash
docker compose -f config/docker-compose.prod.yml exec transkription-webapp sh -lc 'echo "$PDF_CHROMIUM_PATH"; ls -l "$PDF_CHROMIUM_PATH"; "$PDF_CHROMIUM_PATH" --version'
```
4. Falls Pfad nicht stimmt, Kandidaten prüfen:
```bash
docker compose -f config/docker-compose.prod.yml exec transkription-webapp sh -lc 'which chromium-browser || which chromium || which google-chrome-stable || which google-chrome'
```
5. Anschließend `.env` korrigieren und Stack neu laden.

## 7) Erstdeployment

```bash
cd /opt/ghosttyper
# Wichtig: -p ghosttyper setzt den Projektnamen für korrekte Volume-Namen
docker compose -f config/docker-compose.prod.yml --env-file .env -p ghosttyper up --build -d
```

**Hinweise:**
- `--env-file .env` ist erforderlich, da die `.env` im Repo-Root liegt, nicht im `config/`-Ordner.
- `-p ghosttyper` setzt den Projektnamen, damit das richtige DB-Volume verwendet wird.
- `HOSTNAME=0.0.0.0` sorgt dafür, dass die App von außen (Traefik, Healthcheck) erreichbar ist.

Status prüfen:
```bash
docker compose -f config/docker-compose.prod.yml ps
docker compose -f config/docker-compose.prod.yml logs --tail=150 transkription-webapp
```

## 8) Datenbank initialisieren und absichern

Initiale Schema-Erstellung:
```bash
curl -X POST "https://transkription.example.de/api/db-init" \
  -H "x-init-secret: <DB_INIT_SECRET>"
```

Danach sofort härten:

1. `ENABLE_DB_INIT_API=false` in `.env`
2. Container neu starten:
```bash
docker compose -f config/docker-compose.prod.yml up -d
```

## 9) Post-Deploy Verifikation (Abnahme)

1. Health:
```bash
curl -fsS "https://transkription.example.de/api/health"
```
2. Login manuell prüfen.
3. Upload und Transkription manuell prüfen.
4. OCR manuell prüfen.
5. Editor öffnen, speichern, DOCX exportieren.
6. PDF-Export prüfen:
   - Erwartet: PDF öffnet inline im Browserviewer.
   - Nicht erwartet: Browser-Header mit `about:blank`, Datum, Uhrzeit.
7. Optional Admin anlegen:
```bash
docker compose -f config/docker-compose.prod.yml exec transkription-webapp npm run seed-admin
```

## 10) Update-Runbook (jede Auslieferung)

1. Backup von DB + Uploads.
2. Code aktualisieren:
```bash
cd /opt/ghosttyper
git fetch --all
git checkout main
git pull --ff-only
```
3. Rolling Update:
```bash
docker compose -f config/docker-compose.prod.yml --env-file .env -p ghosttyper up --build -d
```
4. Health + Smoke-Checks aus Abschnitt 9.
5. Fehlerfall: Rollback auf letzten stabilen Commit (Abschnitt 12).

## 11) Backup/Restore (Mindeststandard)

Empfohlen täglich (inkrementell) + wöchentlich Vollbackup.

DB-Dump:
```bash
docker compose -f config/docker-compose.prod.yml exec -T transkription-db \
  pg_dump -U "$DB_USER" -d "$DB_NAME" > backup-$(date +%F)-db.sql
```

Uploads sichern:
```bash
docker run --rm \
  -v transkription-uploads:/data \
  -v "$PWD":/backup \
  alpine tar czf /backup/backup-$(date +%F)-uploads.tar.gz -C /data .
```

Restore regelmäßig in separater Umgebung testen.

## 12) Rollback-Plan

1. Letzten stabilen Commit identifizieren:
```bash
git log --oneline -n 20
```
2. Auf stabilen Commit wechseln:
```bash
git checkout <stable-commit-sha>
```
3. Stack neu deployen:
```bash
docker compose -f config/docker-compose.prod.yml up --build -d
```
4. Health + Kernflows prüfen.
5. Rückwechsel auf `main` erst nach Root-Cause-Analyse.

## 13) Betriebsregeln

1. Watchtower nicht unkontrolliert auf diesen Stack anwenden.
2. Disk-Usage monitoren (Warnung ab 80%, Alarm ab 90%).
3. Logs zentralisieren (`LOG_FORMAT=json`).
4. Secrets nie im Git speichern.
5. Änderungen am Deployment nur über dokumentierte Runbooks.

## 14) Troubleshooting Kurzmatrix

1. `503 PDF-Renderer ist nicht verfügbar`:
   - `PDF_CHROMIUM_PATH` im Container prüfen.
   - Chromium-Binary im Container prüfen (`which` + `--version`).
3. Container als `unhealthy` markiert:
   - Healthcheck prüft `http://0.0.0.0:3000/api/health` (nicht `localhost`).
   - `HOSTNAME=0.0.0.0` in `.env` gesetzt?
   - Netzwerk-Labels korrekt (`traefik.docker.network=web`)?
2. PDF zeigt `about:blank`/Datum/Uhrzeit:
   - Serverrenderer fällt aus, Browser-Fallback aktiv.
   - Ursache des Renderer-Fehlers beheben, dann erneut testen.
3. `401 Nicht authentifiziert` bei API:
   - NextAuth-URL/Secret prüfen.
4. `429` bei Last:
   - Rate-Limits prüfen (`RATE_LIMIT_STORE`, DB erreichbar).
5. DB-Fehler beim Start:
   - `DATABASE_URL`, DB-Healthcheck, Volume-Status prüfen.

## 15) Referenzen

1. Umgebungsanalyse: `umgebungsanalyse.md`
2. Compose Produktion: `../config/docker-compose.prod.yml`
3. Projektplan: `../PROJECT_PLAN.md`
4. Test- und Abnahmeplan: `testing.md`
