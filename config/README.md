# Docker-Setup für Transkription WebApp

Dieses Verzeichnis enthält die Docker-Konfiguration für die Transkription WebApp.

## Dateien

- `docker-compose.dev.yml`: Docker Compose-Konfiguration für die Entwicklungsumgebung
- `Dockerfile`: Dockerfile für den Build der WebApp
- `.dockerignore`: Dateien, die beim Docker-Build ignoriert werden sollen

## Voraussetzungen

- Docker
- Docker Compose
- Node.js (für lokale Entwicklung)

## Setup

### 1. Docker-Netzwerk erstellen

```bash
docker network create web
```

### 2. Docker Compose starten

```bash
docker compose -f config/docker-compose.dev.yml up -d
```

### 3. Anwendung starten

Die Anwendung ist unter `http://localhost:3000` verfügbar.

### 4. Traefik-Konfiguration

Die Anwendung ist für die Integration mit Traefik konfiguriert. Die Traefik-Labels in der `docker-compose.dev.yml` müssen an die lokale Traefik-Konfiguration angepasst werden.

## Entwicklung

### 1. Abhängigkeiten installieren

```bash
npm install
```

### 2. Anwendung starten

```bash
npm run dev
```

### 3. Docker-Container neu starten

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