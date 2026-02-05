# Transkriptions-WebApp Projektplan

## Übersicht
Dieses Dokument beschreibt den Projektplan für die Entwicklung einer Transkriptions-WebApp mit Mistral Voxtral als Transkriptionsmodell. Die Anwendung soll auf einem Virtual Private Server (VPS) in einem Docker-Container laufen und über die Subdomain `transkription.helgeroos.de` erreichbar sein.

## Technologiestack

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

### Infrastruktur
- **Containerisierung**: Docker
- **Webserver**: Nginx als Reverse Proxy
- **Deployment**: VPS mit Docker Compose

## Funktionen

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

### 5. Mobile Optimierung
- **Responsives Design**: Optimierung der Benutzeroberfläche für mobile Geräte
- **PWA**: Progressive Web App für bessere mobile Nutzung und Offline-Fähigkeit

## Implementierungsplan

### Schritt 1: Projektinitialisierung
- Erstellen eines neuen Next.js-Projekts
- Einrichtung der Docker-Dateien für Frontend, Backend und Datenbank
- Konfiguration von Nginx für die Subdomain `transkription.helgeroos.de`

### Schritt 2: Authentifizierung und Benutzerverwaltung
- Einrichtung von NextAuth.js mit PostgreSQL als Datenbank
- Implementierung der Benutzerregistrierung und -anmeldung
- Erstellen des Admin-Dashboards für die Benutzerverwaltung
- Implementierung der rollenbasierten Zugriffskontrolle

### Schritt 3: API-Key-Management
- Erstellen einer Tabelle für API-Keys in der Datenbank
- Implementierung der API-Key-Verwaltung im Benutzerprofil
- Integration der API-Keys in die Transkriptionsanfragen

### Schritt 4: Dateiupload und mobile Integration
- Implementierung des Dateiuploads mit Multer oder AWS S3
- Einrichtung der File Access API für direkten Zugriff auf den Handyspeicher
- Implementierung der Share Target API für das Teilen von Audiodateien
- Konfiguration der PWA für bessere mobile Nutzung

### Schritt 5: Template-Management
- Erstellen der Datenbanktabellen für Templates
- Implementierung des Template-Editors
- Erstellen der Template-Auswahl-Komponente
- Implementierung der Template-Formatierungsfunktionen

### Schritt 6: Transkription und Datenaufbereitung
- Integration der Mistral Voxtral API
- Implementierung der Transkriptionslogik
- Verarbeitung der Audiodatei und Rückgabe des transkribierten Textes
- Anwendung der Template-Formatierung auf den transkribierten Text

### Schritt 7: Benutzeroberfläche und mobile Optimierung
- Erstellen von UI-Komponenten für die verschiedenen Seiten
- Implementierung von responsivem Design mit Tailwind CSS
- Optimierung der Benutzeroberfläche für mobile Geräte
- Implementierung von Navigationsmenüs und Benutzerfeedback

### Schritt 8: Docker und Deployment
- Erstellen der Docker-Dateien für Frontend, Backend und Datenbank
- Konfiguration von Docker Compose für die lokale Entwicklung
- Einrichtung des VPS für die Produktion
- Deployment der Anwendung auf dem VPS

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
