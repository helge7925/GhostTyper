# Umgebungsanalyse - VPS Docker-Setup

## Dokumentationsstand
- **Erstellt**: 05.02.2026
- **Aktualisiert**: 05.02.2026
- **Status**: Initialanalyse abgeschlossen

## Systeminformationen

### Hardware
- **Hostname**: docker-ce-ubuntu-8gb-fsn1-1
- **Betriebssystem**: Ubuntu (Kernel 6.8.0-90-generic)
- **Speicher**: 75GB HDD (6.7GB frei - 91% belegt)
- **RAM**: 8GB
- **Uptime**: 1 Woche, 5 Tage

### Warnungen
- **Speicherplatz**: Kritisch! Nur 6.7GB frei (91% belegt)
- **Empfehlung**: Alte Docker-Objekte bereinigen: `docker system prune -a --volumes`

## Docker-Infrastruktur

### Docker-Engine
- **Version**: 27.5.1 (build 9f9e405)
- **Status**: Aktiv (seit 24.01.2026)
- **Container**: 53 Tasks, ~1GB Speichernutzung
- **Netzwerke**: web (extern), paperless-internal

### Bestehende Dienste

#### 1. Immich (Fotoverwaltung)
- **Container**: immich_server, immich_machine_learning, immich_redis, immich_postgres
- **Domain**: photos.helgeroos.de
- **Ports**: 2283 (intern), 80/443 (via Traefik)
- **Datenbank**: PostgreSQL 14 mit pgvector
- **Speicher**: /data (persistent volume)

#### 2. Paperless-ngx (Dokumentenmanagement)
- **Container**: paperless-webserver, paperless-db, paperless-redis, paperless-gotenberg, paperless-tika
- **Domain**: docs.helgeroos.de
- **Ports**: 8000 (intern), 80/443 (via Traefik)
- **Datenbank**: PostgreSQL 16
- **Speicher**: ./data/ (mehrere Volumes)

#### 3. Nextcloud
- **Container**: nextcloud, nextcloud-db
- **Domain**: nextcloud.helgeroos.de
- **Ports**: 80/443 (via Traefik)
- **Datenbank**: MariaDB 10.11
- **Speicher**: ./data/ und ./db/

#### 4. Watchtower
- **Container**: watchtower
- **Funktion**: Automatische Container-Updates
- **Schedule**: Täglich um 4:00 Uhr
- **Netzwerk**: web

## Netzwerk-Architektur

### Docker-Netzwerke
```
web (extern) - Traefik Reverse Proxy
├── immich_server
├── paperless-webserver
├── nextcloud
└── (zukünftig) transkription-frontend

paperless-internal
├── paperless-db
├── paperless-redis
└── (zukünftig) transkription-backend
```

### IP-Adressen
- **Traefik**: 172.18.0.2
- **Paperless-DB**: 172.20.0.3 (angenommen)
- **Immich-DB**: 172.20.0.2

### Port-Nutzung
| Port | Dienst | Protokoll |
|------|--------|-----------|
| 22 | SSH | TCP |
| 80 | HTTP (Traefik) | TCP |
| 443 | HTTPS (Traefik) | TCP |
| 5432 | PostgreSQL (lokal) | TCP |
| 3306 | MariaDB (Nextcloud) | TCP |

## Datenbanken

### PostgreSQL-Instanzen

#### 1. Paperless-DB (paperless-db)
- **Image**: postgres:16
- **Benutzer**: ${POSTGRES_USER}
- **Datenbank**: ${POSTGRES_DB}
- **Volumes**: ./data/postgres
- **Netzwerk**: paperless-internal

#### 2. Immich-DB (immich_postgres)
- **Image**: postgres:14 mit pgvector
- **Benutzer**: ${DB_USERNAME}
- **Datenbank**: ${DB_DATABASE_NAME}
- **Volumes**: ${DB_DATA_LOCATION}
- **Netzwerk**: default

### Empfohlene Integration für Transkription
```sql
-- In Paperless-DB ausführen:
CREATE DATABASE transkription;
CREATE USER transkription WITH PASSWORD 'securepassword';
GRANT ALL PRIVILEGES ON DATABASE transkription TO transkription;

-- Tabellenstruktur:
CREATE TABLE transkription.users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE transkription.api_keys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    key VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Traefik-Konfiguration

### Bestehende Routing-Regeln
```yaml
# Immich
- "traefik.http.routers.immich.rule=Host(`photos.helgeroos.de`)"
- "traefik.http.routers.immich.entrypoints=websecure"

# Paperless
- "traefik.http.routers.paperless.rule=Host(`docs.helgeroos.de`)"
- "traefik.http.routers.paperless.entrypoints=websecure"

# Nextcloud
- "traefik.http.routers.nextcloud.rule=Host(`nextcloud.helgeroos.de`)"
- "traefik.http.routers.nextcloud.entrypoints=websecure"
```

### Empfohlene Konfiguration für Transkription
```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.transkription.rule=Host(`transkription.helgeroos.de`)"
  - "traefik.http.routers.transkription.entrypoints=websecure"
  - "traefik.http.routers.transkription.tls.certresolver=letsencrypt"
  - "traefik.http.services.transkription.loadbalancer.server.port=3000"
```

## Speicheranalyse

### Aktuelle Nutzung
```
Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        75G   66G  6.7G  91% /
```

### Docker-Speichernutzung
```bash
# Bereinigung empfohlen:
docker system prune -a --volumes

# Große Container identifizieren:
docker ps --size

# Unused Volumes löschen:
docker volume prune
```

### Empfohlene Maßnahmen
1. Alte Images bereinigen: `docker image prune -a`
2. Unused Volumes löschen: `docker volume prune`
3. Container-Logs rotieren
4. Monitoring einrichten für Speicherplatz

## Integrationsstrategie für Transkriptions-WebApp

### Container-Struktur
```yaml
services:
  transkription-frontend:
    image: node:18-alpine
    networks:
      - web
    labels:
      - traefik-Routing (siehe oben)

  transkription-backend:
    image: node:18-alpine
    networks:
      - web
      - paperless-internal
    environment:
      - DATABASE_URL=postgresql://transkription:secure@paperless-db:5432/transkription
```

### Netzwerk-Integration
- **Frontend**: Anbindung an `web`-Netzwerk für Traefik
- **Backend**: Anbindung an `web` und `paperless-internal`
- **Datenbank**: Nutzung der bestehenden Paperless-DB

### Deployment-Strategie
1. Lokale Entwicklung mit `docker-compose.dev.yml`
2. Staging auf VPS mit `docker-compose.staging.yml`
3. Produktion mit `docker-compose.prod.yml`

## Sicherheitsaspekte

### Aktuelle Konfiguration
- Traefik mit Let's Encrypt (automatische Zertifikate)
- Docker-Proxy für Port-Forwarding
- Separate Datenbank-Benutzer

### Empfehlungen für Transkription
1. Environment-Variablen für API-Keys
2. JWT-Authentifizierung
3. Rate-Limiting für API-Endpoints
4. Input-Validation für alle Requests

## Nächste Schritte

### 1. Bereinigung
```bash
# Speicherplatz freigeben
docker system prune -a --volumes

# Große Dateien identifizieren
sudo du -h /opt/docker | sort -h | tail -20
```

### 2. Datenbank vorbereiten
```bash
# In Paperless-DB-Container
docker exec -it paperless-db psql -U postgres
-- Dann SQL-Befehle von oben ausführen
```

### 3. Docker-Konfiguration erstellen
- `config/docker-compose.dev.yml` für lokale Entwicklung
- `config/docker-compose.prod.yml` für Produktion

### 4. Grundgerüst implementieren
- Next.js Frontend
- Node.js Backend
- Datenbank-Migrationen

## Anhang: Nützliche Befehle

### Docker-Analyse
```bash
# Alle Container mit Status
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Netzwerk-Inspektion
docker network inspect web

# Container-Logs
docker logs <container-name>
```

### Datenbank-Analyse
```bash
# In Paperless-DB
docker exec -it paperless-db psql -U postgres -c "\l"

# Benutzer anzeigen
docker exec -it paperless-db psql -U postgres -c "\du"
```

### Traefik-Analyse
```bash
# Traefik-Logs
docker logs immich_server | grep traefik

# Routing-Konfiguration
docker exec -it immich_server cat /etc/traefik/traefik.yml
```

---

**Letzte Aktualisierung**: 05.02.2026
**Verantwortlich**: Helge Roos
**Status**: Analyse abgeschlossen, Integration vorbereitet