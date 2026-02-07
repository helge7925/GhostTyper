# AI-Integration Dokumentation

## Übersicht

Dieses Dokument beschreibt die AI-Integration für die Transkription WebApp. Die Anwendung verwendet Mistral Voxtral für die Transkription und Mistral Large für die Analyse.

## Architektur

### AI-Integration-Fluss

1. **Transkription**: Die Audio-Datei wird mit Mistral Voxtral transkribiert.
2. **Analyse**: Die Transkription wird mit Mistral Large analysiert.
3. **Speichern**: Die Transkription und Analyse werden in der Datenbank gespeichert.

## Konfiguration

### Mistral-API

Die Mistral-API wird in der Datei `lib/mistral.js` definiert:

```javascript
import axios from 'axios'

const MISTRAL_VOXTRAL_API_URL = 'https://api.mistral.ai/v1/voxtral'
const MISTRAL_LARGE_API_URL = 'https://api.mistral.ai/v1/large'
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY

export async function transcribeAudio(filePath) {
  try {
    const response = await axios.post(
      MISTRAL_VOXTRAL_API_URL,
      {
        file: filePath,
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    )

    return response.data.transcription
  } catch (error) {
    console.error('Error transcribing audio:', error)
    throw error
  }
}

export async function analyzeTranscription(transcription) {
  try {
    const response = await axios.post(
      MISTRAL_LARGE_API_URL,
      {
        text: transcription,
      },
      {
        headers: {
          'Authorization': `Bearer ${MISTRAL_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    )

    return response.data.analysis
  } catch (error) {
    console.error('Error analyzing transcription:', error)
    throw error
  }
}
```

### API-Endpoint

Der API-Endpoint für die AI-Integration ist in der Datei `pages/api/transcribe.js` definiert:

```javascript
import { transcribeAudio, analyzeTranscription } from '../../lib/mistral'
import { saveTranscription } from '../../lib/database'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { filePath } = req.body

    // Transkription
    const transcription = await transcribeAudio(filePath)

    // Analyse
    const analysis = await analyzeTranscription(transcription)

    // Speichern in der Datenbank
    const result = await saveTranscription(filePath, transcription, analysis)

    return res.status(200).json({ success: true, data: result })
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' })
  }
}
```

### Datenbank

Die Datenbank-Funktionen sind in der Datei `lib/database.js` definiert:

```javascript
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function saveTranscription(filePath, transcription, analysis) {
  try {
    const result = await prisma.transcription.create({
      data: {
        filePath,
        transcription,
        analysis,
      },
    })

    return result
  } catch (error) {
    console.error('Error saving transcription:', error)
    throw error
  }
}
```

### Umgebung

Die Umgebung wird über die `.env`-Datei konfiguriert. Eine Beispiel-Datei ist im Repository enthalten.

- **MISTRAL_API_KEY**: Mistral API-Schlüssel
- **NEXT_PUBLIC_API_URL**: URL der API
- **DATABASE_URL**: URL der Datenbank
- **NEXTAUTH_SECRET**: Geheimnis für NextAuth.js
- **NEXTAUTH_URL**: URL der Anwendung

## Setup

### Voraussetzungen

- Next.js
- Node.js
- Datenbank (PostgreSQL)
- Mistral API-Schlüssel

### Installation

1. **Abhängigkeiten installieren**:

```bash
npm install axios @prisma/client
```

2. **Mistral-API-Konfiguration erstellen**:

```bash
mkdir -p lib
```

3. **Mistral-API-Konfiguration erstellen**:

```bash
touch lib/mistral.js
```

4. **Mistral-API-Konfiguration bearbeiten**:

```bash
nano lib/mistral.js
```

5. **API-Endpoint erstellen**:

```bash
mkdir -p pages/api
```

6. **API-Endpoint erstellen**:

```bash
touch pages/api/transcribe.js
```

7. **API-Endpoint bearbeiten**:

```bash
nano pages/api/transcribe.js
```

8. **Datenbank-Konfiguration erstellen**:

```bash
touch lib/database.js
```

9. **Datenbank-Konfiguration bearbeiten**:

```bash
nano lib/database.js
```

## Entwicklung

### 1. AI-Integration testen

1. **Anwendung starten**:

```bash
npm run dev
```

2. **AI-Integration testen**:

Die Anwendung ist unter `http://localhost:3000` verfügbar. Die AI-Integration ist unter `http://localhost:3000/api/transcribe` verfügbar.

### 2. API-Endpoint testen

1. **API-Endpoint testen**:

```bash
curl -X POST -H "Content-Type: application/json" -d '{"filePath": "test.mp3"}' http://localhost:3000/api/transcribe
```

## Probleme

### 1. Mistral-API-Verbindung

Falls die Mistral-API-Verbindung fehlschlägt, müssen die Mistral-API-Credentials überprüft werden:

```bash
nano .env
```

### 2. Datenbank-Verbindung

Falls die Datenbank-Verbindung fehlschlägt, muss die Datenbank-Konfiguration überprüft werden:

```bash
nano config/docker-compose.dev.yml
```

### 3. Transkription fehlschlägt

Falls die Transkription fehlschlägt, müssen die Audio-Datei-Berechtigungen überprüft werden:

```bash
mkdir -p uploads
chmod -R 777 uploads
```

## Tests

### Lokale Tests

1. **Anwendung starten**:

```bash
npm run dev
```

2. **AI-Integration testen**:

Die Anwendung ist unter `http://localhost:3000` verfügbar. Die AI-Integration ist unter `http://localhost:3000/api/transcribe` verfügbar.

### VPS-Tests

1. **Anwendung starten**:

```bash
docker compose -f config/docker-compose.dev.yml up -d
```

2. **AI-Integration testen**:

Die Anwendung ist unter `https://transkription.helgeroos.de` verfügbar. Die AI-Integration ist unter `https://transkription.helgeroos.de/api/transcribe` verfügbar.

## Dokumentation

- [Umgebungsanalyse](umgebungsanalyse.md)
- [API-Spezifikation](api-specification.md)
- [Projektplan](PROJECT_PLAN.md)
- [Docker-Setup](docker-setup.md)
- [Authentifizierung](authentication.md)
- [CI/CD-Pipeline](ci-cd-pipeline.md)
- [Audio-Upload](audio-upload.md)

## Nächste Schritte

1. **Testen und Verifizierung**: Testen und Verifizierung der gesamten Implementierung.