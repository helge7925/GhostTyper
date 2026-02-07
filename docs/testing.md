# Testen und Verifizierung Dokumentation

## Übersicht

Dieses Dokument beschreibt das Testen und die Verifizierung für die Transkription WebApp. Die Anwendung wird lokal und auf dem VPS getestet.

## Architektur

### Test-Fluss

1. **Lokale Tests**: Die Anwendung wird lokal getestet.
2. **VPS-Tests**: Die Anwendung wird auf dem VPS getestet.
3. **Fehlerbehebung**: Fehler werden behoben.
4. **Verifizierung**: Die Anwendung wird verifiziert.

## Konfiguration

### Test-Dateien

Die Test-Dateien sind in der Datei `tests/` definiert:

```javascript
import { test, expect } from '@playwright/test'

test('Homepage', async ({ page }) => {
  await page.goto('http://localhost:3000')
  await expect(page).toHaveTitle('Transkription WebApp')
})

test('Audio-Upload', async ({ page }) => {
  await page.goto('http://localhost:3000/upload')
  await expect(page).toHaveTitle('Audio-Upload')
})

test('API-Health', async ({ page }) => {
  await page.goto('http://localhost:3000/api/health')
  await expect(page).toHaveTitle('Health')
})
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
- Playwright

### Installation

1. **Abhängigkeiten installieren**:

```bash
npm install @playwright/test
```

2. **Test-Dateien erstellen**:

```bash
mkdir -p tests
```

3. **Test-Dateien erstellen**:

```bash
touch tests/homepage.spec.js
touch tests/upload.spec.js
touch tests/api.spec.js
```

4. **Test-Dateien bearbeiten**:

```bash
nano tests/homepage.spec.js
nano tests/upload.spec.js
nano tests/api.spec.js
```

## Entwicklung

### 1. Lokale Tests

1. **Anwendung starten**:

```bash
npm run dev
```

2. **Tests ausführen**:

```bash
npx playwright test
```

3. **Tests überprüfen**:

Die Tests sind unter `http://localhost:3000` verfügbar.

### 2. VPS-Tests

1. **Anwendung starten**:

```bash
docker compose -f config/docker-compose.dev.yml up -d
```

2. **Tests ausführen**:

```bash
npx playwright test
```

3. **Tests überprüfen**:

Die Tests sind unter `https://transkription.helgeroos.de` verfügbar.

## Probleme

### 1. Tests fehlschlagen

Falls die Tests fehlschlagen, müssen die Test-Dateien überprüft werden:

```bash
nano tests/homepage.spec.js
nano tests/upload.spec.js
nano tests/api.spec.js
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

2. **Tests ausführen**:

```bash
npx playwright test
```

3. **Tests überprüfen**:

Die Tests sind unter `http://localhost:3000` verfügbar.

### VPS-Tests

1. **Anwendung starten**:

```bash
docker compose -f config/docker-compose.dev.yml up -d
```

2. **Tests ausführen**:

```bash
npx playwright test
```

3. **Tests überprüfen**:

Die Tests sind unter `https://transkription.helgeroos.de` verfügbar.

## Dokumentation

- [Umgebungsanalyse](umgebungsanalyse.md)
- [API-Spezifikation](api-specification.md)
- [Projektplan](PROJECT_PLAN.md)
- [Docker-Setup](docker-setup.md)
- [Authentifizierung](authentication.md)
- [CI/CD-Pipeline](ci-cd-pipeline.md)
- [Audio-Upload](audio-upload.md)
- [AI-Integration](ai-integration.md)

## Nächste Schritte

1. **Dokumentation aktualisieren**: Aktualisierung der Dokumentation mit den neuen Implementierungen.