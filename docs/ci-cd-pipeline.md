# CI/CD-Pipeline Dokumentation

## Übersicht

Dieses Dokument beschreibt die CI/CD-Pipeline für die Transkription WebApp. Die Pipeline wird mit GitHub Actions implementiert und umfasst Build, Test und Deployment.

## Architektur

### GitHub Actions

GitHub Actions ist eine CI/CD-Plattform, die direkt in GitHub integriert ist. Sie ermöglicht die Automatisierung von Build-, Test- und Deployment-Prozessen.

### Pipeline-Fluss

1. **Build**: Die Anwendung wird gebaut.
2. **Test**: Die Anwendung wird getestet.
3. **Deployment**: Die Anwendung wird bereitgestellt.

## Konfiguration

### GitHub Actions-Konfiguration

Die GitHub Actions-Konfiguration ist in der Datei `.github/workflows/ci-cd.yml` definiert:

```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [ main, develop, feature/** ]
  pull_request:
    branches: [ main, develop ]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Use Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Install dependencies
        run: npm install
      - name: Build application
        run: npm run build
      - name: Upload build artifacts
        uses: actions/upload-artifact@v3
        with:
          name: build-artifacts
          path: ./

  test:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v3
        with:
          name: build-artifacts
      - name: Use Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Install dependencies
        run: npm install
      - name: Run tests
        run: npm test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v3
        with:
          name: build-artifacts
      - name: Use Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Install dependencies
        run: npm install
      - name: Build Docker image
        run: docker build -t transkription-webapp .
      - name: Log in to Docker Hub
        uses: docker/login-action@v2
        with:
          username: ${{ secrets.DOCKER_HUB_USERNAME }}
          password: ${{ secrets.DOCKER_HUB_TOKEN }}
      - name: Push Docker image
        run: docker push transkription-webapp:latest
      - name: Deploy to VPS
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USERNAME }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /path/to/transkription_webapp
            git pull origin main
            docker compose -f config/docker-compose.dev.yml down
            docker compose -f config/docker-compose.dev.yml up -d
```

### Umgebung

Die Umgebung wird über die GitHub Actions-Secrets konfiguriert. Die Secrets müssen in den GitHub Repository-Einstellungen definiert werden.

- **DOCKER_HUB_USERNAME**: Docker Hub Benutzername
- **DOCKER_HUB_TOKEN**: Docker Hub Token
- **VPS_HOST**: VPS Host
- **VPS_USERNAME**: VPS Benutzername
- **VPS_SSH_KEY**: VPS SSH-Schlüssel

## Setup

### Voraussetzungen

- GitHub Repository
- Docker Hub Account
- VPS mit Docker und Docker Compose

### Installation

1. **GitHub Actions-Konfiguration erstellen**:

```bash
mkdir -p .github/workflows
```

2. **GitHub Actions-Konfiguration erstellen**:

```bash
touch .github/workflows/ci-cd.yml
```

3. **GitHub Actions-Konfiguration bearbeiten**:

```bash
nano .github/workflows/ci-cd.yml
```

4. **GitHub Secrets konfigurieren**:

Die Secrets müssen in den GitHub Repository-Einstellungen definiert werden.

## Entwicklung

### 1. Pipeline testen

1. **Änderungen committen**:

```bash
git add .
git commit -m "Test CI/CD Pipeline"
git push origin main
```

2. **Pipeline überprüfen**:

Die Pipeline ist unter `https://github.com/username/transkription_webapp/actions` verfügbar.

### 2. Pipeline anpassen

1. **Pipeline bearbeiten**:

```bash
nano .github/workflows/ci-cd.yml
```

2. **Änderungen committen**:

```bash
git add .
git commit -m "Update CI/CD Pipeline"
git push origin main
```

## Probleme

### 1. Pipeline fehlschlägt

Falls die Pipeline fehlschlägt, müssen die Logs überprüft werden:

```bash
https://github.com/username/transkription_webapp/actions
```

### 2. Docker-Build fehlschlägt

Falls der Docker-Build fehlschlägt, muss die Dockerfile überprüft werden:

```bash
nano Dockerfile
```

### 3. Deployment fehlschlägt

Falls das Deployment fehlschlägt, müssen die VPS-Einstellungen überprüft werden:

```bash
ssh username@host
cd /path/to/transkription_webapp
docker compose -f config/docker-compose.dev.yml logs
```

## Tests

### Lokale Tests

1. **Pipeline testen**:

```bash
npm install
npm run build
npm test
```

2. **Docker-Build testen**:

```bash
docker build -t transkription-webapp .
```

### VPS-Tests

1. **Pipeline testen**:

```bash
git add .
git commit -m "Test CI/CD Pipeline"
git push origin main
```

2. **Deployment testen**:

Die Anwendung ist unter `https://transkription.helgeroos.de` verfügbar.

## Dokumentation

- [Umgebungsanalyse](umgebungsanalyse.md)
- [API-Spezifikation](api-specification.md)
- [Projektplan](PROJECT_PLAN.md)
- [Docker-Setup](docker-setup.md)
- [Authentifizierung](authentication.md)

## Nächste Schritte

1. **Audio-Upload-Endpoint implementieren**: Backend-Endpoint für den Audio-Upload erstellen.
2. **AI-Integration**: Mistral-APIs für Transkription und Analyse integrieren.