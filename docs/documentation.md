# Dokumentation

## Übersicht

Dieses Dokument beschreibt die Dokumentation für die Transkription WebApp. Die Dokumentation umfasst alle Aspekte der Anwendung, von der Umgebungsanalyse bis zur AI-Integration.

## Architektur

### Dokumentations-Fluss

1. **Umgebungsanalyse**: Analyse der bestehenden Docker-Umgebung auf dem VPS.
2. **API-Spezifikation**: Spezifikation der API-Endpunkte.
3. **Projektplan**: Planung der Implementierung.
4. **Docker-Setup**: Konfiguration der Docker-Umgebung.
5. **Authentifizierung**: Implementierung der Authentifizierung.
6. **CI/CD-Pipeline**: Einrichtung der CI/CD-Pipeline.
7. **Audio-Upload**: Implementierung des Audio-Uploads.
8. **AI-Integration**: Integration der Mistral-APIs.
9. **Testen und Verifizierung**: Testen und Verifizierung der gesamten Implementierung.
10. **Dokumentation**: Aktualisierung der Dokumentation.

## Konfiguration

### Dokumentations-Dateien

Die Dokumentations-Dateien sind in der Datei `docs/` definiert:

```markdown
# Umgebungsanalyse

## Übersicht

Dieses Dokument beschreibt die Umgebungsanalyse für die Transkription WebApp.

## Architektur

### Docker-Umgebung

Die Docker-Umgebung auf dem VPS umfasst mehrere Container und Netzwerke.

### Docker-Container

1. **Traefik**: Reverse Proxy für die Anwendung.
2. **Paperless-DB**: PostgreSQL-Datenbank für die Anwendung.
3. **Immich**: Bildverarbeitungsanwendung.
4. **Nextcloud**: Cloud-Speicheranwendung.

### Docker-Netzwerke

1. **web**: Netzwerk für die Webanwendungen.
2. **default**: Standardnetzwerk für die Docker-Container.

### Docker-Volumes

1. **paperless-db-data**: Volume für die Paperless-DB-Daten.
2. **immich-data**: Volume für die Immich-Daten.
3. **nextcloud-data**: Volume für die Nextcloud-Daten.

### Docker-Images

1. **traefik**: Image für den Traefik-Reverse Proxy.
2. **postgres**: Image für die PostgreSQL-Datenbank.
3. **immich**: Image für die Immich-Anwendung.
4. **nextcloud**: Image für die Nextcloud-Anwendung.

### Docker-Netzwerk

Die Container sind im Docker-Netzwerk `web` verbunden, das auch von anderen Diensten auf dem VPS verwendet wird.

### Traefik-Integration

Die Anwendung ist für die Integration mit Traefik konfiguriert. Traefik wird als Reverse Proxy verwendet, um die Anwendung unter der Subdomain `transkription.helgeroos.de` verfügbar zu machen.

### Datenbank

Die Anwendung verwendet eine PostgreSQL-Datenbank. Die Datenbank-Konfiguration ist in der `docker-compose.dev.yml` definiert.

- **Benutzername**: postgres
- **Passwort**: postgres
- **Datenbank**: transkription
- **Port**: 5432

### Umgebung

Die Umgebung wird über die `.env`-Datei konfiguriert. Eine Beispiel-Datei ist im Repository enthalten.

- **NEXT_PUBLIC_API_URL**: URL der API
- **DATABASE_URL**: URL der Datenbank
- **NEXTAUTH_SECRET**: Geheimnis für NextAuth.js
- **NEXTAUTH_URL**: URL der Anwendung

### Probleme

1. **Docker-Netzwerk**: Falls das Docker-Netzwerk `web` nicht existiert, muss es manuell erstellt werden.
2. **Docker Compose**: Falls Docker Compose nicht installiert ist, muss es installiert werden.
3. **Speicherplatz**: Falls der Speicherplatz auf dem VPS knapp ist, kann der Docker-Speicher bereinigt werden.

### Tests

1. **Lokale Tests**: Die Anwendung wird lokal getestet.
2. **VPS-Tests**: Die Anwendung wird auf dem VPS getestet.

### Dokumentation

- [API-Spezifikation](api-specification.md)
- [Projektplan](PROJECT_PLAN.md)
- [Docker-Setup](docker-setup.md)
- [Authentifizierung](authentication.md)
- [CI/CD-Pipeline](ci-cd-pipeline.md)
- [Audio-Upload](audio-upload.md)
- [AI-Integration](ai-integration.md)
- [Testen und Verifizierung](testing.md)

### Nächste Schritte

1. **API-Spezifikation**: Spezifikation der API-Endpunkte.
2. **Projektplan**: Planung der Implementierung.
3. **Docker-Setup**: Konfiguration der Docker-Umgebung.
4. **Authentifizierung**: Implementierung der Authentifizierung.
5. **CI/CD-Pipeline**: Einrichtung der CI/CD-Pipeline.
6. **Audio-Upload**: Implementierung des Audio-Uploads.
7. **AI-Integration**: Integration der Mistral-APIs.
8. **Testen und Verifizierung**: Testen und Verifizierung der gesamten Implementierung.
9. **Dokumentation**: Aktualisierung der Dokumentation.
```

### Umgebung

Die Umgebung wird über die `.env`-Datei konfiguriert. Eine Beispiel-Datei ist im Repository enthalten.

- **NEXT_PUBLIC_API_URL**: URL der API
- **DATABASE_URL**: URL der Datenbank
- **NEXTAUTH_SECRET**: Geheimnis für NextAuth.js
- **NEXTAUTH_URL**: URL der Anwendung

## Setup

### Voraussetzungen

- Next.js
- Node.js
- Datenbank (PostgreSQL)
- Docker
- Docker Compose

### Installation

1. **Dokumentations-Dateien erstellen**:

```bash
mkdir -p docs
```

2. **Dokumentations-Dateien erstellen**:

```bash
touch docs/umgebungsanalyse.md
touch docs/api-specification.md
touch docs/docker-setup.md
touch docs/authentication.md
touch docs/ci-cd-pipeline.md
touch docs/audio-upload.md
touch docs/ai-integration.md
touch docs/testing.md
touch docs/documentation.md
```

3. **Dokumentations-Dateien bearbeiten**:

```bash
nano docs/umgebungsanalyse.md
nano docs/api-specification.md
nano docs/docker-setup.md
nano docs/authentication.md
nano docs/ci-cd-pipeline.md
nano docs/audio-upload.md
nano docs/ai-integration.md
nano docs/testing.md
nano docs/documentation.md
```

## Entwicklung

### 1. Dokumentation aktualisieren

1. **Dokumentation bearbeiten**:

```bash
nano docs/umgebungsanalyse.md
nano docs/api-specification.md
nano docs/docker-setup.md
nano docs/authentication.md
nano docs/ci-cd-pipeline.md
nano docs/audio-upload.md
nano docs/ai-integration.md
nano docs/testing.md
nano docs/documentation.md
```

2. **Dokumentation überprüfen**:

Die Dokumentation ist unter `docs/` verfügbar.

### 2. Dokumentation testen

1. **Dokumentation testen**:

```bash
npm run dev
```

2. **Dokumentation überprüfen**:

Die Dokumentation ist unter `http://localhost:3000` verfügbar.

## Probleme

### 1. Dokumentation fehlschlägt

Falls die Dokumentation fehlschlägt, müssen die Dokumentations-Dateien überprüft werden:

```bash
nano docs/umgebungsanalyse.md
nano docs/api-specification.md
nano docs/docker-setup.md
nano docs/authentication.md
nano docs/ci-cd-pipeline.md
nano docs/audio-upload.md
nano docs/ai-integration.md
nano docs/testing.md
nano docs/documentation.md
```

### 2. Anwendung nicht verfügbar

Falls die Anwendung nicht verfügbar ist, müssen die Docker-Container überprüft werden:

```bash
docker compose -f config/docker-compose.dev.yml logs
```

### 3. Datenbank-Verbindung

Falls die Datenbank-Verbindung fehlschlägt, muss die Datenbank-Konfiguration überprüft werden:

```bash
nano config/docker-compose.dev.yml
```

## Tests

### Lokale Tests

1. **Anwendung starten**:

```bash
npm run dev
```

2. **Dokumentation testen**:

Die Dokumentation ist unter `http://localhost:3000` verfügbar.

### VPS-Tests

1. **Anwendung starten**:

```bash
docker compose -f config/docker-compose.dev.yml up -d
```

2. **Dokumentation testen**:

Die Dokumentation ist unter `https://transkription.helgeroos.de` verfügbar.

## Dokumentation

- [Umgebungsanalyse](umgebungsanalyse.md)
- [API-Spezifikation](api-specification.md)
- [Projektplan](PROJECT_PLAN.md)
- [Docker-Setup](docker-setup.md)
- [Authentifizierung](authentication.md)
- [CI/CD-Pipeline](ci-cd-pipeline.md)
- [Audio-Upload](audio-upload.md)
- [AI-Integration](ai-integration.md)
- [Testen und Verifizierung](testing.md)

## Nächste Schritte

1. **Projekt abschließen**: Abschluss des Projekts und Bereitstellung für die Nutzung.