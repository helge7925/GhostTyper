# Transkription WebApp Dokumentation

## Übersicht

Dieses Verzeichnis enthält die Dokumentation für die Transkription WebApp. Die Anwendung umfasst die Entwicklung einer Transkriptions-WebApp mit dynamischer Audio-Analyse unter Nutzung von Mistral Voxtral und Mistral Large, integriert in eine bestehende Docker-Umgebung auf einem VPS.

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
11. **Projektabschluss**: Abschluss des Projekts und Bereitstellung für die Nutzung.

## Dateien

- [Umgebungsanalyse](umgebungsanalyse.md): Analyse der bestehenden Docker-Umgebung auf dem VPS.
- [API-Spezifikation](api-specification.md): Spezifikation der API-Endpunkte.
- [Projektplan](PROJECT_PLAN.md): Planung der Implementierung.
- [Docker-Setup](docker-setup.md): Konfiguration der Docker-Umgebung.
- [Authentifizierung](authentication.md): Implementierung der Authentifizierung.
- [CI/CD-Pipeline](ci-cd-pipeline.md): Einrichtung der CI/CD-Pipeline.
- [Audio-Upload](audio-upload.md): Implementierung des Audio-Uploads.
- [AI-Integration](ai-integration.md): Integration der Mistral-APIs.
- [Testen und Verifizierung](testing.md): Testen und Verifizierung der gesamten Implementierung.
- [Dokumentation](documentation.md): Aktualisierung der Dokumentation.
- [Projektabschluss](project-completion.md): Abschluss des Projekts und Bereitstellung für die Nutzung.
- [Implementierung](implementation.md): Implementierung der gesamten Anwendung.

## Umgebung

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
touch docs/project-completion.md
touch docs/implementation.md
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
nano docs/project-completion.md
nano docs/implementation.md
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
nano docs/project-completion.md
nano docs/implementation.md
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
nano docs/project-completion.md
nano docs/implementation.md
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
- [Dokumentation](documentation.md)
- [Projektabschluss](project-completion.md)
- [Implementierung](implementation.md)

## Nächste Schritte

1. **Projekt abschließen**: Abschluss des Projekts und Bereitstellung für die Nutzung.