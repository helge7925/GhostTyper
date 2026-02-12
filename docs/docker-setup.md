# Docker-Setup Dokumentation

## Übersicht

Dieses Dokument beschreibt das Docker-Setup für die Transkription WebApp. Die Anwendung wird in Docker-Containern bereitgestellt und in die bestehende Docker-Umgebung auf dem VPS integriert.

## Architektur

### Docker-Container

1. **transkription-webapp**: Der Haupt-Container für die Next.js-Anwendung
2. **paperless-db**: Der PostgreSQL-Datenbank-Container

### Docker-Netzwerk

Die Container sind im Docker-Netzwerk `web` verbunden, das auch von anderen Diensten auf dem VPS verwendet wird.

### Traefik-Integration

Die Anwendung ist für die Integration mit Traefik konfiguriert. Traefik wird als Reverse Proxy verwendet, um die Anwendung unter der Subdomain `transkription.helgeroos.de` verfügbar zu machen.

## Konfiguration

### docker-compose.dev.yml

Die Docker Compose-Datei definiert die Container und ihre Konfiguration:

```yaml
version: '3.8'

services:
  transkription-webapp:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: transkription-webapp
    restart: unless-stopped
    networks:
      - web
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.transkription.rule=Host(`transkription.helgeroos.de`)"
      - "traefik.http.routers.transkription.entrypoints=websecure"
      - "traefik.http.routers.transkription.tls.certresolver=letsencrypt"
      - "traefik.http.services.transkription.loadbalancer.server.port=3000"
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      - NODE_ENV=development
      - NEXT_PUBLIC_API_URL=http://localhost:3000/api
      - DATABASE_URL=postgresql://postgres:postgres@paperless-db:5432/transkription
    depends_on:
      - paperless-db

  paperless-db:
    image: postgres:13
    container_name: paperless-db
    restart: unless-stopped
    networks:
      - web
    volumes:
      - paperless-db-data:/var/lib/postgresql/data
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=transkription
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

networks:
  web:
    external: true

volumes:
  paperless-db-data:
```

### Dockerfile

Das Dockerfile nutzt einen Multi-Stage Build zur Minimierung der Image-Größe und enthält die notwendigen Tools für die Audio-Verarbeitung:

```dockerfile
# Stage 1: Install dependencies
FROM node:20-alpine AS deps
...
# Stage 3: Production runner
FROM node:20-alpine AS runner
...
RUN apk add --no-cache ffmpeg
...
```

**Besonderheiten:**
- **Node.js 20**: Ermöglicht die Nutzung moderner Bibliotheken (z.B. marked v17).
- **FFmpeg**: Vorinstalliert im Runner-Image zur Konvertierung von Audio-Aufnahmen (WebM -> MP3).
- **Standalone-Build**: Nutzt das Next.js Standalone-Feature für maximale Effizienz.


## Setup

### Voraussetzungen

- Docker
- Docker Compose
- Node.js (für lokale Entwicklung)

### Installation

1. **Docker-Netzwerk erstellen**:

```bash
docker network create web
```

2. **Docker Compose starten**:

```bash
docker compose -f config/docker-compose.dev.yml up -d
```

3. **Anwendung starten**:

Die Anwendung ist unter `http://localhost:3000` verfügbar.

### Entwicklung

1. **Abhängigkeiten installieren**:

```bash
npm install
```

2. **Anwendung starten**:

```bash
npm run dev
```

3. **Docker-Container neu starten**:

```bash
docker compose -f config/docker-compose.dev.yml restart
```

## Datenbank

Die Anwendung verwendet eine PostgreSQL-Datenbank. Die Datenbank-Konfiguration ist in der `docker-compose.dev.yml` definiert.

- **Benutzername**: postgres
- **Passwort**: postgres
- **Datenbank**: transkription
- **Port**: 5432

## Umgebung

Die Umgebung wird über die `.env`-Datei konfiguriert. Eine Beispiel-Datei ist im Repository enthalten.

- **NEXT_PUBLIC_API_URL**: URL der API
- **DATABASE_URL**: URL der Datenbank
- **NEXTAUTH_SECRET**: Geheimnis für NextAuth.js
- **NEXTAUTH_URL**: URL der Anwendung

## Probleme

### 1. Docker-Netzwerk

Falls das Docker-Netzwerk `web` nicht existiert, muss es manuell erstellt werden:

```bash
docker network create web
```

### 2. Docker Compose

Falls Docker Compose nicht installiert ist, muss es installiert werden:

```bash
sudo apt install docker-compose-plugin
```

### 3. Speicherplatz

Falls der Speicherplatz auf dem VPS knapp ist, kann der Docker-Speicher bereinigt werden:

```bash
docker system prune -a --volumes
```

## Tests

### Lokale Tests

1. **Docker-Container starten**:

```bash
docker compose -f config/docker-compose.dev.yml up -d
```

2. **Anwendung testen**:

Die Anwendung ist unter `http://localhost:3000` verfügbar. Die API ist unter `http://localhost:3000/api/health` verfügbar.

### VPS-Tests

1. **Docker-Container starten**:

```bash
docker compose -f config/docker-compose.dev.yml up -d
```

2. **Anwendung testen**:

Die Anwendung ist unter `https://transkription.helgeroos.de` verfügbar. Die API ist unter `https://transkription.helgeroos.de/api/health` verfügbar.

## Dokumentation

- [Umgebungsanalyse](umgebungsanalyse.md)
- [API-Spezifikation](api-specification.md)
- [Projektplan](../PROJECT_PLAN.md)

## Nächste Schritte

1. **Authentifizierung implementieren**: NextAuth.js einrichten und in die Anwendung integrieren.
2. **CI/CD-Pipeline einrichten**: GitHub Actions für Build, Test und Deployment konfigurieren.
3. **Audio-Upload-Endpoint implementieren**: Backend-Endpoint für den Audio-Upload erstellen.
4. **AI-Integration**: Mistral-APIs für Transkription und Analyse integrieren.
