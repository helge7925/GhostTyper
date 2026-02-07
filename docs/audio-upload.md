# Audio-Upload Dokumentation

## Übersicht

Dieses Dokument beschreibt den Audio-Upload für die Transkription WebApp. Die Anwendung ermöglicht das Hochladen von Audio-Dateien für die Transkription und Analyse.

## Architektur

### Audio-Upload-Fluss

1. **Hochladen**: Der Benutzer lädt eine Audio-Datei hoch.
2. **Speichern**: Die Audio-Datei wird auf dem Server gespeichert.
3. **Transkription**: Die Audio-Datei wird transkribiert.
4. **Analyse**: Die Transkription wird analysiert.
5. **Speichern**: Die Transkription und Analyse werden in der Datenbank gespeichert.

## Konfiguration

### API-Endpoint

Der API-Endpoint für den Audio-Upload ist in der Datei `pages/api/upload.js` definiert:

```javascript
import { IncomingForm } from 'formidable'
import fs from 'fs'
import path from 'path'

export const config = {
  api: {
    bodyParser: false,
  },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const form = new IncomingForm()
    form.uploadDir = path.join(process.cwd(), 'uploads')
    form.keepExtensions = true

    form.parse(req, async (err, fields, files) => {
      if (err) {
        return res.status(500).json({ error: 'Error parsing files' })
      }

      const file = files.file
      const filePath = file.filepath
      const fileName = file.originalFilename
      const fileSize = file.size
      const fileType = file.mimetype

      // Speichern der Datei
      const newPath = path.join(process.cwd(), 'uploads', fileName)
      fs.renameSync(filePath, newPath)

      // Transkription und Analyse
      const transcription = await transcribeAudio(newPath)
      const analysis = await analyzeTranscription(transcription)

      // Speichern in der Datenbank
      const result = await saveTranscription(fileName, transcription, analysis)

      return res.status(200).json({ success: true, data: result })
    })
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function transcribeAudio(filePath) {
  // Transkription mit Mistral Voxtral
  return 'Transkription der Audio-Datei'
}

async function analyzeTranscription(transcription) {
  // Analyse mit Mistral Large
  return 'Analyse der Transkription'
}

async function saveTranscription(fileName, transcription, analysis) {
  // Speichern in der Datenbank
  return { fileName, transcription, analysis }
}
```

### Frontend-Komponente

Die Frontend-Komponente für den Audio-Upload ist in der Datei `components/AudioUpload.js` definiert:

```javascript
import { useState } from 'react'
import axios from 'axios'

export default function AudioUpload() {
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  const handleFileChange = (e) => {
    setFile(e.target.files[0])
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!file) {
      setError('Bitte wählen Sie eine Datei aus')
      return
    }

    setUploading(true)
    setError(null)
    setSuccess(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await axios.post('/api/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })

      setSuccess('Datei erfolgreich hochgeladen')
    } catch (error) {
      setError('Fehler beim Hochladen der Datei')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <h1>Audio-Upload</h1>
      <form onSubmit={handleSubmit}>
        <input type="file" onChange={handleFileChange} accept="audio/*" />
        <button type="submit" disabled={uploading}>
          {uploading ? 'Hochladen...' : 'Hochladen'}
        </button>
      </form>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {success && <p style={{ color: 'green' }}>{success}</p>}
    </div>
  )
}
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

### Installation

1. **Abhängigkeiten installieren**:

```bash
npm install axios formidable
```

2. **API-Endpoint erstellen**:

```bash
mkdir -p pages/api
```

3. **API-Endpoint erstellen**:

```bash
touch pages/api/upload.js
```

4. **API-Endpoint bearbeiten**:

```bash
nano pages/api/upload.js
```

5. **Frontend-Komponente erstellen**:

```bash
mkdir -p components
```

6. **Frontend-Komponente erstellen**:

```bash
touch components/AudioUpload.js
```

7. **Frontend-Komponente bearbeiten**:

```bash
nano components/AudioUpload.js
```

## Entwicklung

### 1. Audio-Upload testen

1. **Anwendung starten**:

```bash
npm run dev
```

2. **Audio-Upload testen**:

Die Anwendung ist unter `http://localhost:3000` verfügbar. Der Audio-Upload ist unter `http://localhost:3000/upload` verfügbar.

### 2. API-Endpoint testen

1. **API-Endpoint testen**:

```bash
curl -X POST -F "file=@test.mp3" http://localhost:3000/api/upload
```

## Probleme

### 1. Datei-Upload fehlschlägt

Falls der Datei-Upload fehlschlägt, müssen die Datei-Berechtigungen überprüft werden:

```bash
mkdir -p uploads
chmod -R 777 uploads
```

### 2. Transkription fehlschlägt

Falls die Transkription fehlschlägt, müssen die Mistral-API-Credentials überprüft werden:

```bash
nano .env
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

2. **Audio-Upload testen**:

Die Anwendung ist unter `http://localhost:3000` verfügbar. Der Audio-Upload ist unter `http://localhost:3000/upload` verfügbar.

### VPS-Tests

1. **Anwendung starten**:

```bash
docker compose -f config/docker-compose.dev.yml up -d
```

2. **Audio-Upload testen**:

Die Anwendung ist unter `https://transkription.helgeroos.de` verfügbar. Der Audio-Upload ist unter `https://transkription.helgeroos.de/upload` verfügbar.

## Dokumentation

- [Umgebungsanalyse](umgebungsanalyse.md)
- [API-Spezifikation](api-specification.md)
- [Projektplan](PROJECT_PLAN.md)
- [Docker-Setup](docker-setup.md)
- [Authentifizierung](authentication.md)
- [CI/CD-Pipeline](ci-cd-pipeline.md)

## Nächste Schritte

1. **AI-Integration**: Mistral-APIs für Transkription und Analyse integrieren.