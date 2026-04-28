# API-Spezifikation - Transkriptions-WebApp

## Dokumentationsstand
- **Erstellt**: 05.02.2026
- **Letzte Aktualisierung**: 28.04.2026
- **Status**: Inkrementell aktualisiert (Legacy-Inhalte + aktuelle Ergänzungen)
- **Version**: 0.2

## Übersicht

### Basis-URL
- **Lokale Entwicklung**: `http://localhost:5000/api`
- **Produktion**: `https://transkription.helgeroos.de/api`

### Authentifizierung
- **JWT-Token**: Im Header `Authorization: Bearer <token>`
- **API-Key**: Im Header `X-API-Key: <api-key>`

### Content-Type
- **Request**: `application/json`
- **Response**: `application/json`

## Aktuelle Ergänzungen (2026-04-28)

### Funktionsbereinigung
- Entfernte App-Bereiche: Echtzeitverarbeitung, Wissensgraph, Mindmap, Infografik/Sketch, Text-Assistent und Workflows.
- Entfernte API-Bereiche: `/api/realtime/*`, `/api/workflows/*`, `/api/text-ai`, `/api/text-tasks/*`, `/api/sketch-summary`.
- Google/Gemini-Key-Verwaltung ist nicht mehr Teil der Settings-API. Die aktive KI-/OCR-Konfiguration basiert auf Mistral.
- Tabellen-Vorlagen sind content-only: API und Prompting lassen keine Berechnungen, Formeln oder Summen für neue Tabellen-Vorlagen zu.

### GET `/api/settings`
**Beschreibung**: Lädt benutzerbezogene App- und API-Key-Settings.
**Auth**: Session erforderlich

**Response (200), relevante Felder**:
```json
{
  "apiKeyConfigured": true,
  "defaultTemplate": "generic",
  "language": "de",
  "contextBias": "Begriff A, Begriff B",
  "preferredModel": "mistral-large-latest",
  "defaultTranslateLanguage": "en",
  "ocrModel": "mistral-ocr-latest",
  "costLimit": 15.0,
  "memberMonthlyBudgetLimit": 8.0
}
```

### POST/PUT `/api/settings`
**Beschreibung**: Speichert Settings (beide Methoden werden unterstützt).
**Auth**: Session erforderlich

**Request (Beispiel)**:
```json
{
  "mistralApiKey": "mistral-...",
  "costLimit": 15,
  "memberMonthlyBudgetLimit": 8,
  "preferredModel": "mistral-large-latest"
}
```

**Response (200)**:
```json
{
  "message": "Einstellungen gespeichert"
}
```

**Fehler**:
- `400`: ungültiges Modell/OCR-Modell oder ungültige Limits
- `500`: veraltetes DB-Schema (z. B. fehlende neue Spalten)

### PATCH `/api/transcriptions/:id`
**Beschreibung**: Speichert Änderungen am Dokument oder an einer Tabellenanalyse.
**Auth**: Session erforderlich

**Request für Tabellenanalyse**:
```json
{
  "tableData": {
    "metadata": {
      "datum": "2026-04-28",
      "bearbeiter": "Max Mustermann"
    },
    "rows": [
      {
        "row_key": "wand_1",
        "laenge": 3.2,
        "breite": 2.4,
        "bemerkung": "nachgemessen"
      }
    ]
  }
}
```

**Response (200)**:
```json
{
  "message": "Transkription aktualisiert"
}
```

### POST/PUT `/api/templates` mit `template_type: "table"`
**Beschreibung**: Erstellt oder aktualisiert eine Tabellen-Vorlage.
**Auth**: Session erforderlich

**Request (Beispiel)**:
```json
{
  "name": "Aufmaß Küche",
  "prompt_text": "Fülle die Tabelle anhand des Diktats.",
  "template_type": "table",
  "table_schema": {
    "tableName": "Aufmaß Küche",
    "metadataFields": [
      { "key": "datum", "label": "Datum", "type": "date" },
      { "key": "bearbeiter", "label": "Bearbeiter", "type": "text" }
    ],
    "rows": [
      { "key": "wand_1", "label": "Wand 1" },
      { "key": "wand_2", "label": "Wand 2" }
    ],
    "columns": [
      { "key": "laenge", "label": "Länge", "type": "number" },
      { "key": "breite", "label": "Breite", "type": "number" },
      { "key": "bemerkung", "label": "Bemerkung", "type": "text" }
    ]
  }
}
```

Hinweis:
- `table_schema` wird serverseitig normalisiert.
- Nicht erlaubte Felder wie `calculations` werden entfernt.
- Tabellen-Vorlagen speichern Struktur, keine berechneten Ergebnisse.

## Endpunkte

### 1. Authentifizierung

#### POST `/api/auth/register`
**Beschreibung**: Benutzerregistrierung

**Request**:
```json
{
  "email": "user@example.com",
  "password": "securePassword123!",
  "name": "Max Mustermann"
}
```

**Response (201)**:
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "Max Mustermann",
  "createdAt": "2026-02-05T12:00:00Z"
}
```

**Fehler**:
- `400`: Ungültige E-Mail oder Passwort
- `409`: Benutzer existiert bereits

#### POST `/api/auth/login`
**Beschreibung**: Benutzeranmeldung

**Request**:
```json
{
  "email": "user@example.com",
  "password": "securePassword123!"
}
```

**Response (200)**:
```json
{
  "token": "jwt.token.here",
  "expiresIn": 3600,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "Max Mustermann"
  }
}
```

**Fehler**:
- `401`: Ungültige Anmeldedaten
- `403`: Konto gesperrt

#### POST `/api/auth/refresh`
**Beschreibung**: Token-Refresh

**Request**:
```json
{
  "token": "expired.jwt.token"
}
```

**Response (200)**:
```json
{
  "token": "new.jwt.token",
  "expiresIn": 3600
}
```

### 2. API-Key-Verwaltung

#### GET `/api/keys`
**Beschreibung**: API-Keys auflisten
**Auth**: JWT erforderlich

**Response (200)**:
```json
[
  {
    "id": "key-id",
    "key": "api-key-here",
    "createdAt": "2026-02-05T12:00:00Z",
    "expiresAt": "2026-08-05T12:00:00Z"
  }
]
```

#### POST `/api/keys`
**Beschreibung**: Neuen API-Key generieren
**Auth**: JWT erforderlich

**Response (201)**:
```json
{
  "id": "key-id",
  "key": "neuer-api-key-here",
  "createdAt": "2026-02-05T12:00:00Z",
  "expiresAt": "2026-08-05T12:00:00Z"
}
```

#### DELETE `/api/keys/:id`
**Beschreibung**: API-Key löschen
**Auth**: JWT erforderlich

**Response (204)**: (Kein Inhalt)

### 3. Audio-Upload

#### POST `/api/upload`
**Beschreibung**: Audiodatei hochladen
**Auth**: API-Key oder JWT

**Request**:
```bash
curl -X POST \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: multipart/form-data" \
  -F "audio=@datei.mp3" \
  -F "context=meeting" \
  https://transkription.helgeroos.de/api/upload
```

**Response (202)**:
```json
{
  "id": "job-id",
  "status": "processing",
  "createdAt": "2026-02-05T12:00:00Z",
  "estimatedCompletion": "2026-02-05T12:01:00Z"
}
```

**Fehler**:
- `400`: Ungültiger Dateityp
- `413`: Datei zu groß (>50MB)
- `401`: Ungültiger API-Key

### 4. Transkriptions-Jobs

#### GET `/api/jobs`
**Beschreibung**: Alle Jobs auflisten
**Auth**: JWT oder API-Key

**Response (200)**:
```json
[
  {
    "id": "job-id",
    "status": "completed",
    "type": "meeting",
    "createdAt": "2026-02-05T12:00:00Z",
    "completedAt": "2026-02-05T12:01:00Z",
    "result": {
      "transcriptionId": "transcript-id"
    }
  }
]
```

#### GET `/api/jobs/:id`
**Beschreibung**: Job-Status abfragen
**Auth**: JWT oder API-Key

**Response (200)**:
```json
{
  "id": "job-id",
  "status": "processing",
  "progress": 75,
  "type": "meeting",
  "createdAt": "2026-02-05T12:00:00Z",
  "audio": {
    "filename": "meeting.mp3",
    "size": 1234567,
    "duration": 180
  }
}
```

### 5. Transkriptions-Ergebnisse

#### GET `/api/transcriptions/:id`
**Beschreibung**: Transkriptionsergebnis abrufen
**Auth**: JWT oder API-Key

**Response (200) - Meeting**:
```json
{
  "id": "transcript-id",
  "type": "meeting",
  "status": "completed",
  "createdAt": "2026-02-05T12:00:00Z",
  "analysis": {
    "summary": "Zusammenfassung des Meetings...",
    "todos": [
      {
        "task": "Feature XY implementieren",
        "priority": "high",
        "owner": "Max Mustermann",
        "deadline": "2026-02-12"
      }
    ],
    "decisions": [
      "Entscheidung 1",
      "Entscheidung 2"
    ],
    "themes": [
      {
        "topic": "Technische Umsetzung",
        "todos": [...]
      }
    ]
  },
  "rawTranscription": "Rohtext der Transkription..."
}
```

**Response (200) - Aufmaß**:
```json
{
  "id": "transcript-id",
  "type": "aufmass",
  "status": "completed",
  "createdAt": "2026-02-05T12:00:00Z",
  "analysis": {
    "rooms": [
      {
        "name": "Küche",
        "measurements": [
          {
            "type": "Arbeitsplatte",
            "value": 2.5,
            "unit": "m"
          }
        ]
      }
    ],
    "warnings": ["Raumhöhe 20 cm – bitte prüfen!"]
  },
  "rawTranscription": "Rohtext der Transkription..."
}
```

### 6. Template-Verwaltung

#### GET `/api/templates`
**Beschreibung**: Alle Templates auflisten
**Auth**: JWT erforderlich

**Response (200)**:
```json
[
  {
    "id": "template-id",
    "name": "Meeting-Protokoll",
    "type": "meeting",
    "createdAt": "2026-02-05T12:00:00Z"
  },
  {
    "id": "template-id",
    "name": "Aufmaß-Vorlage",
    "type": "aufmass",
    "createdAt": "2026-02-05T12:00:00Z"
  }
]
```

#### POST `/api/templates`
**Beschreibung**: Neues Template erstellen
**Auth**: JWT erforderlich

**Request**:
```json
{
  "name": "Neues Meeting-Template",
  "type": "meeting",
  "content": "Template-Inhalt als JSON-Schema..."
}
```

**Response (201)**:
```json
{
  "id": "template-id",
  "name": "Neues Meeting-Template",
  "type": "meeting",
  "createdAt": "2026-02-05T12:00:00Z"
}
```

## Fehlerbehandlung

### Standard-Fehlerformat
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Fehlermeldung",
    "details": {}
  }
}
```

### Häufige Fehlercodes

| Code | Status | Beschreibung |
|------|--------|--------------|
| `AUTH_001` | 401 | Ungültige Anmeldedaten |
| `AUTH_002` | 403 | Token abgelaufen |
| `VALIDATION_001` | 400 | Ungültige Eingabedaten |
| `UPLOAD_001` | 413 | Datei zu groß |
| `UPLOAD_002` | 415 | Ungültiger Dateityp |
| `RATE_LIMIT` | 429 | Zu viele Anfragen |
| `SERVER_ERROR` | 500 | Interner Serverfehler |

## Rate Limiting

- **Anonyme Anfragen**: 10 Requests/Minute
- **Authentifizierte Anfragen**: 100 Requests/Minute
- **Header**: `X-RateLimit-Remaining: 95`

## Webhooks

### POST `/api/webhooks/transcription`
**Beschreibung**: Benachrichtigung bei abgeschlossener Transkription

**Request**:
```json
{
  "event": "transcription.completed",
  "data": {
    "id": "transcript-id",
    "status": "completed",
    "type": "meeting",
    "userId": "user-id"
  }
}
```

## Versionierung

- **API-Version**: `v1` (im Pfad: `/api/v1/...`)
- **Deprecation-Policy**: 6 Monate Vorlauf
- **Changelog**: In `docs/CHANGELOG.md`

## Beispiele

### Kompletter Workflow

1. **Upload**:
```bash
curl -X POST \
  -H "X-API-Key: your-api-key" \
  -F "audio=@meeting.mp3" \
  -F "context=meeting" \
  https://transkription.helgeroos.de/api/upload
```

2. **Status abfragen**:
```bash
curl -H "X-API-Key: your-api-key" \
  https://transkription.helgeroos.de/api/jobs/job-id
```

3. **Ergebnis abrufen**:
```bash
curl -H "X-API-Key: your-api-key" \
  https://transkription.helgeroos.de/api/transcriptions/transcript-id
```

## Offene Punkte

1. **Authentifizierungs-Flow finalisieren**
   - JWT vs. API-Key Priorisierung
   - Token-Lifetime

2. **Webhook-Implementierung**
   - Welche Events benötigt?
   - Signatur-Verifikation

3. **Rate-Limiting**
   - Genauere Limits pro Endpunkt
   - Burst-Capacity

4. **Datenaufbewahrung**
   - Wie lange werden Transkriptionen gespeichert?
   - GDPR-Compliance

## Nächste Schritte

1. **Authentifizierung implementieren**
   - NextAuth.js Konfiguration
   - JWT-Generierung
   - API-Key-Management

2. **Upload-Endpoint implementieren**
   - Dateivalidierung
   - Speicher-Handling
   - Job-Queue

3. **Transkriptions-Logik**
   - Mistral-API-Integration
   - Ergebnis-Formatierung
   - Template-Anwendung

4. **Dokumentation vervollständigen**
   - Beispiele für alle Endpunkte
   - Fehlerbehandlung detaillieren
   - Authentifizierungs-Flow

---

**Letzte Aktualisierung**: 05.02.2026
**Verantwortlich**: Helge Roos
**Status**: Initialentwurf - Feedback willkommen
