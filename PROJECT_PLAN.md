# Transkriptions-WebApp Projektplan (Erweitert)

## Übersicht
Dieses Dokument beschreibt den Projektplan für die Entwicklung einer Transkriptions-WebApp mit dynamischer Audio-Analyse. Die Anwendung nutzt Mistral Voxtral für die Transkription und Mistral Large für die kontextsensitive Analyse von Audioaufnahmen. Das Projekt wird in einen bestehenden Docker-Container auf einem VPS integriert.

## Technologiestack (erweitert)

### Frontend
- **Framework**: Next.js (für Server-Side Rendering und mobile Optimierung)
- **Styling**: Tailwind CSS (für responsives Design)
- **Mobile Integration**: File Access API und Share Target API
- **PWA**: Progressive Web App für bessere mobile Nutzung

### Backend
- **Framework**: Node.js mit Express (oder Next.js API Routes)
- **Datenbank**: PostgreSQL (für relationale Daten und Benutzerverwaltung)
- **Authentifizierung**: NextAuth.js mit JWT
- **Dateiupload**: Multer für lokale Speicherung oder AWS S3 für Skalierbarkeit

### KI-Integration
- **Mistral Voxtral**: Für Rohtranskription mit Metadaten
- **Mistral Large**: Für dynamische kontextsensitive Analyse
- **Prompt-Engineering**: Dynamische Prompt-Generierung basierend auf Audio-Charakteristika

### Infrastruktur
- **Containerisierung**: Integration in bestehenden Docker-Container
- **Webserver**: Nginx als Reverse Proxy (bereits vorhanden)
- **Deployment**: VPS mit Docker Compose (bestehende Umgebung)

## Funktionen (erweitert)

### 1. Benutzerauthentifizierung
- **Anmeldung und Registrierung**: Benutzer können sich registrieren und anmelden
- **API-Key-Verwaltung**: Jeder Benutzer hat einen eigenen API-Key, der mit seinem Konto verknüpft ist
- **Admin-Dashboard**: Verwaltung aller Benutzerkonten und API-Keys
- **Rollenbasierte Zugriffskontrolle**: Unterschiedliche Berechtigungen für Admin und normale Benutzer

### 2. Dateiupload
- **Handyspeicher-Zugriff**: Direkter Zugriff auf den Handyspeicher für Audiodateien
- **Share Target API**: Ermöglicht das Teilen von Audiodateien direkt aus anderen Apps
- **Dateivalidierung**: Überprüfung von Dateitypen und -größen

### 3. Template-Management
- **Benutzerdefinierte Templates**: Erstellen, Bearbeiten und Löschen von Templates
- **Template-Vorlagen**: Vorgefertigte Templates wie "Protokoll" und "Aufmaß"
- **Template-Editor**: Einfache Oberfläche zum Erstellen neuer Templates

### 4. Transkription
- **Integration der Mistral Voxtral API**: Verarbeitung der Audiodatei und Rückgabe des transkribierten Textes
- **Datenaufbereitung**: Formatierung der transkribierten Daten basierend auf dem Template

### 5. Dynamische Audio-Analyse
- **Zweistufige Verarbeitung**: Voxtral → Large
- **Kontextadaptive Ausgabe**: Automatische Anpassung der Ausgabe an Komplexität
- **Relevanzfilterung**: Priorisierung wichtiger Informationen
- **Plausibilitätsprüfung**: Automatische Validierung von Messwerten

### 6. Meeting-Analyse
- **Dynamische Strukturierung**: Von einfachen Zusammenfassungen bis zu thematischen Hierarchien
- **To-Do Extraktion**: Mit Priorisierung und Verantwortlichen
- **Entscheidungsprotokollierung**: Automatische Identifikation von Beschlüssen
- **Widerspruchserkennung**: Markierung von Inkonsistenzen

### 7. Aufmaß-Analyse
- **Hierarchische Strukturierung**: Nach Räumen und Elementen
- **Einheiten-Normalisierung**: Automatische Einheitenerkennung und -konvertierung
- **Plausibilitätswarnungen**: Für unrealistische Messwerte
- **Flexible Ausgabeformate**: Von einfachen Listen bis zu komplexen Hierarchien

### 8. Mobile Optimierung
- **Responsives Design**: Optimierung der Benutzeroberfläche für mobile Geräte
- **PWA**: Progressive Web App für bessere mobile Nutzung und Offline-Fähigkeit

## Implementierungsplan (angepasst für bestehende Docker-Umgebung)

### Phase 1: Umgebunganalyse (1-2 Tage)
- Prüfung der bestehenden Docker-Compose-Datei
- Identifikation verfügbarer Ressourcen (Ports, Volumes, Netzwerke)
- Analyse der Nginx-Konfiguration für Subdomain-Integration
- Abstimmung der Integrationsstrategie

### Phase 2: Frontend-Integration (3-5 Tage)
- Anpassung des Next.js-Frontends für Subroute-Betrieb
- Konfiguration der API-Endpoints
- Testing der Integration in bestehende Umgebung

### Phase 3: Backend-Integration (5-7 Tage)
- Anpassung der API-Routes für bestehende Nginx-Konfiguration
- Datenbank-Integration (Nutzung bestehender PostgreSQL oder neues Schema)
- AI-API-Anbindung (Mistral Voxtral & Large)

### Phase 4: AI-Integration (3-5 Tage)
- Implementierung der Mistral-API-Aufrufe
- Prompt-Management-System
- Ergebnisverarbeitung und Validierung

### Phase 5: Dynamische Analyse-Module (5-7 Tage)
- Meeting-Analyse-Pipeline
- Aufmaß-Analyse-Pipeline
- Validierungslogik und Plausibilitätsprüfung

### Phase 6: Docker-Integration (2-3 Tage)
- Erstellung minimaler Docker-Konfiguration für neue Komponenten
- Anpassung an bestehendes Docker-Netzwerk
- Health-Check-Implementierung

### Phase 7: Testing & Deployment (2-3 Tage)
- Integrationstests in der bestehenden Umgebung
- Performance-Tests
- Rollout-Strategie mit minimaler Downtime

### Phase 8: Monitoring & Wartung
- Integration in bestehende Monitoring-Tools
- Log-Integration in bestehende Systeme
- Health-Check-Endpoints

## Docker-Integration in bestehende Umgebung

### Container-Struktur
```
Bestehender VPS-Container
├── Bestehende Services
│   ├── Nginx (bereits konfiguriert)
│   ├── Datenbank (PostgreSQL, falls vorhanden)
│   └── Andere Dienste
│
└── Neue Transkriptions-Komponenten
    ├── Frontend (Next.js) - als Subroute /transkription
    ├── Backend (Node.js) - als API-Endpoint /api/transkription
    └── AI-Worker (Python) - optional als separater Service
```

### Docker-Compose-Erweiterung
```yaml
# Ergänzung zur bestehenden docker-compose.yml
services:
  transkription-frontend:
    image: node:18-alpine
    working_dir: /app
    volumes:
      - ./transkription/frontend:/app
      - /app/node_modules
    command: sh -c "yarn install && yarn build && yarn start"
    environment:
      - NEXT_PUBLIC_API_URL=/api/transkription
      - NODE_ENV=production
    networks:
      - existing_network  # Nutzung des bestehenden Netzwerks
    restart: unless-stopped

  transkription-backend:
    image: node:18-alpine
    working_dir: /app
    volumes:
      - ./transkription/backend:/app
      - /app/node_modules
    command: sh -c "yarn install && yarn start"
    environment:
      - DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@existing_db:5432/${DB_NAME}
      - JWT_SECRET=${JWT_SECRET}
      - MISTRAL_VOXTRAL_API_KEY=${MISTRAL_VOXTRAL_KEY}
      - MISTRAL_LARGE_API_KEY=${MISTRAL_LARGE_KEY}
    networks:
      - existing_network
    restart: unless-stopped
```

### Nginx-Konfiguration (Erweiterung)
```nginx
# Ergänzung zur bestehenden Nginx-Konfiguration
location /transkription {
    proxy_pass http://transkription-frontend:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /api/transkription {
    proxy_pass http://transkription-backend:5000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Datenbank-Integration

### Option A: Nutzung bestehender PostgreSQL
```sql
-- Erstellung eines neuen Schemas für die Transkriptions-Anwendung
CREATE SCHEMA transkription;

-- Benutzerverwaltung
CREATE TABLE transkription.users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- API-Key-Verwaltung
CREATE TABLE transkription.api_keys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES transkription.users(id) ON DELETE CASCADE,
    key VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE
);

-- Transkriptions-Jobs
CREATE TABLE transkription.jobs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES transkription.users(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### Option B: Separate Datenbank-Instanz
Falls keine bestehende PostgreSQL verfügbar ist, kann eine separate Instanz im bestehenden Docker-Netzwerk eingerichtet werden.

## AI-Integration

### Direkte API-Nutzung (empfohlen)
```javascript
// Beispiel: Backend-Integration der Mistral-APIs
const { MistralClient } = require('@mistralai/mistralai');

class AIService {
    constructor() {
        this.voxtalClient = new MistralClient(process.env.MISTRAL_VOXTRAL_API_KEY);
        this.largeClient = new MistralClient(process.env.MISTRAL_LARGE_API_KEY);
    }

    async transcribeAudio(audioBuffer) {
        // Mistral Voxtral für Rohtranskription
        const transcription = await this.voxtalClient.transcribe(audioBuffer);
        return transcription;
    }

    async analyzeTranscription(transcription, context) {
        // Dynamische Prompt-Generierung
        const prompt = this.generatePrompt(transcription, context);
        
        // Mistral Large für Analyse
        const analysis = await this.largeClient.analyze(prompt);
        return analysis;
    }

    generatePrompt(transcription, context) {
        // Dynamische Prompt-Erstellung basierend auf Kontext
        if (context.type === 'meeting') {
            return this.generateMeetingPrompt(transcription);
        } else if (context.type === 'aufmass') {
            return this.generateAufmassPrompt(transcription);
        }
    }
}
```

## Beispiel-Prompts

### Meeting-Analyse-Prompt
```plaintext
Analysiere das folgende Meeting-Transkript und passe die Ausgabe dynamisch an:

1. Bei kurzen/unklaren Meetings:
   - Kurzzusammenfassung (3-5 Sätze)
   - Explizite To-Dos mit Priorität
   - Hinweis auf fehlende Entscheidungen

2. Bei langen/strukturierten Meetings:
   - Ausführliche Zusammenfassung
   - Thematische Gruppierung
   - Priorisierte To-Dos mit Verantwortlichen und Deadlines
   - Entscheidungsprotokoll
   - Unklarheiten und Widersprüche markieren

3. Immer:
   - Prüfe auf zeitliche Widersprüche
   - Markiere Unklarheiten mit "uncertain: true"
   - Identifiziere die 3 wichtigsten Punkte

Transkript: ${transcription}
Kontext: ${context}
```

### Aufmaß-Analyse-Prompt
```plaintext
Analysiere die folgenden Aufmaß-Daten und strukturiere sie dynamisch:

1. Bei einfachen Aufmaßen (1-2 Elemente):
   - Flache Liste mit Messwerten
   - Standard-Einheiten annehmen
   - Einfache Notizen

2. Bei komplexen Aufmaßen (mehrere Räume/Elemente):
   - Hierarchische Struktur nach Räumen
   - Gruppierung nach Elementtypen
   - Warnungen für unrealistische Werte
   - Einheiten-Normalisierung

3. Immer:
   - Plausibilitätsprüfung (z.B. Raumhöhe > 1.5m)
   - Fehlende Einheiten → Standard annehmen + Hinweis
   - Konsistenzprüfung zwischen Messwerten

Daten: ${measurementData}
Kontext: ${context}
```

## Deployment-Strategie

### 1. Vorbereitung
```bash
# Auf dem VPS
mkdir -p transkription/{frontend,backend}
cd transkription
```

### 2. Erstes Deployment
```bash
# Kopieren der Projektdateien
scp -r lokaler_pfad/transkription/* user@vps:transkription/

# Container starten
docker-compose up -d --build
```

### 3. Updates
```bash
# Nur geänderte Services neu starten
docker-compose up -d --no-deps --build transkription-frontend
```

### 4. Rollback
```bash
# Bei Problemen: Zurück zum vorherigen Zustand
git checkout stable-version
docker-compose up -d --build
```

## Monitoring & Wartung

### Health-Check-Endpoints
- `/api/transkription/health` - Backend-Status
- `/transkription/api/health` - Frontend-Status
- `/api/transkription/ai/health` - AI-Service-Status

### Logging
- Integration in bestehende Log-Management-Systeme
- Strukturierte Logs für einfache Analyse
- Fehler-Tracking für AI-Analysen

## Nächste Schritte

1. **Umgebungsanalyse**:
   - Bereitstellung der bestehenden Docker-Compose-Datei
   - Klärung der Datenbank-Situation
   - Festlegung der gewünschten Subdomain/Route

2. **Technische Entscheidungen**:
   - AI-Integration: Direkt im Backend oder separater Worker?
   - Datenbank: Nutzung bestehender Instanz oder separate?
   - Authentifizierung: Integration in bestehendes System oder separates?

3. **Priorisierung**:
   - Soll zuerst das Frontend, Backend oder die AI-Integration umgesetzt werden?
   - Welche Funktionen haben höchste Priorität?

4. **Zeitplan**:
   - Festlegung von Meilensteinen
   - Ressourcenplanung
   - Testphase und Benutzer-Feedback

Dieser aktualisierte Plan berücksichtigt die Integration in die bestehende Docker-Umgebung und enthält alle Erweiterungen für die dynamische Audio-Analyse mit Mistral Voxtral & Large. Die Implementierung erfolgt schrittweise mit minimalem Eingriff in das bestehende System.

## Beispielcode

### File Access API für direkten Zugriff auf den Handyspeicher

```jsx
import React, { useState } from 'react';

const FileUpload = () => {
  const [file, setFile] = useState(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
  };

  const handleUpload = async () => {
    if (!file) return;

    const formData = new FormData();
    formData.append('audio', file);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        console.log('File uploaded successfully:', data);
      } else {
        console.error('Upload failed');
      }
    } catch (error) {
      console.error('Error uploading file:', error);
    }
  };

  return (
    <div>
      <input
        type="file"
        accept="audio/*"
        capture="environment"
        onChange={handleFileChange}
        style={{ display: 'none' }}
        id="file-input"
      />
      <label htmlFor="file-input">
        <button
          onClick={() => document.getElementById('file-input').click()}
          style={{
            padding: '10px 20px',
            backgroundColor: '#0070f3',
            color: '#fff',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
          }}
        >
          Audiodatei hochladen
        </button>
      </label>
      {file && (
        <div>
          <p>Ausgewählte Datei: {file.name}</p>
          <button
            onClick={handleUpload}
            style={{
              padding: '10px 20px',
              backgroundColor: '#28a745',
              color: '#fff',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              marginTop: '10px',
            }}
          >
            Hochladen
          </button>
        </div>
      )}
    </div>
  );
};

export default FileUpload;
```

### Share Target API für das Teilen von Audiodateien

```json
// manifest.json
{
  "name": "Transkription WebApp",
  "short_name": "Transkription",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#0070f3",
  "share_target": {
    "action": "/api/share",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "title": "name",
      "text": "description",
      "files": [
        {
          "name": "audio",
          "accept": ["audio/*"]
        }
      ]
    }
  }
}
```

### Template-Editor

```jsx
import React, { useState } from 'react';

const TemplateEditor = ({ onSave }) => {
  const [templateName, setTemplateName] = useState('');
  const [templateContent, setTemplateContent] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      name: templateName,
      content: templateContent,
    });
    setTemplateName('');
    setTemplateContent('');
  };

  return (
    <div>
      <h2>Neues Template erstellen</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="template-name">Template-Name:</label>
          <input
            type="text"
            id="template-name"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="template-content">Template-Inhalt:</label>
          <textarea
            id="template-content"
            value={templateContent}
            onChange={(e) => setTemplateContent(e.target.value)}
            required
          />
        </div>
        <button type="submit">Template speichern</button>
      </form>
    </div>
  );
};

export default TemplateEditor;
```

### API-Key-Verwaltung

```jsx
import React, { useState, useEffect } from 'react';

const ApiKeyManagement = ({ userId }) => {
  const [apiKey, setApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchApiKey = async () => {
      try {
        const response = await fetch(`/api/api-keys?userId=${userId}`);
        if (response.ok) {
          const data = await response.json();
          setApiKey(data.apiKey);
        }
      } catch (error) {
        console.error('Error fetching API key:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchApiKey();
  }, [userId]);

  const handleGenerateApiKey = async () => {
    try {
      const response = await fetch('/api/api-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId }),
      });

      if (response.ok) {
        const data = await response.json();
        setApiKey(data.apiKey);
      }
    } catch (error) {
      console.error('Error generating API key:', error);
    }
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <h2>API-Key-Verwaltung</h2>
      {apiKey ? (
        <div>
          <p>Ihr API-Key:</p>
          <code>{apiKey}</code>
        </div>
      ) : (
        <p>Kein API-Key vorhanden.</p>
      )}
      <button onClick={handleGenerateApiKey}>
        {apiKey ? 'API-Key neu generieren' : 'API-Key generieren'}
      </button>
    </div>
  );
};

export default ApiKeyManagement;
```

## Docker-Konfiguration

### Dockerfile für das Frontend

```dockerfile
# Dockerfile für das Frontend
FROM node:16-alpine AS builder

WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install
COPY . .
RUN yarn build

FROM node:16-alpine
WORKDIR /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/yarn.lock ./yarn.lock
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000
CMD ["yarn", "start"]
```

### Dockerfile für das Backend

```dockerfile
# Dockerfile für das Backend
FROM node:16-alpine

WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install
COPY . .

EXPOSE 5000
CMD ["yarn", "start"]
```

### Docker Compose für die lokale Entwicklung

```yaml
version: '3.8'

services:
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:5000
    depends_on:
      - backend

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "5000:5000"
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/transkription
      - JWT_SECRET=your_jwt_secret
    depends_on:
      - db

  db:
    image: postgres:13
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=transkription
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

## Nginx-Konfiguration für die Subdomain

```nginx
server {
    listen 80;
    server_name transkription.helgeroos.de;

    location / {
        proxy_pass http://frontend:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api {
        proxy_pass http://backend:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Nächste Schritte

1. **Projektinitialisierung**: Erstellen des Next.js-Projekts und Einrichtung der Docker-Dateien
2. **Authentifizierung**: Implementierung der Benutzerauthentifizierung und API-Key-Verwaltung
3. **Dateiupload**: Implementierung des Dateiuploads und der mobilen Integration
4. **Template-Management**: Implementierung des Template-Editors und der Template-Auswahl
5. **Transkription**: Integration der Mistral Voxtral API und Implementierung der Transkriptionslogik
6. **Benutzeroberfläche**: Erstellen der UI-Komponenten und Optimierung für mobile Geräte
7. **Deployment**: Einrichtung des VPS und Deployment der Anwendung

Sobald Sie bereit sind, können wir mit der Implementierung beginnen. Lassen Sie mich wissen, ob Sie Änderungen oder Ergänzungen an diesem Plan haben, oder ob wir direkt mit der Umsetzung starten sollen.
