# Transkriptions-WebApp Projektplan

## Übersicht
Web-Anwendung für Audio-Transkription und KI-gestützte Analyse. Nutzt Mistral Voxtral Mini für die Transkription und Mistral Large für die kontextsensitive Analyse. Deployment auf einem Hetzner VPS mit Docker und Traefik.

## Technologiestack

| Komponente | Technologie |
|---|---|
| Frontend | Next.js 13 (Pages Router), React 18, Tailwind CSS 3 |
| Backend | Next.js API Routes |
| Datenbank | PostgreSQL 16 (eigene DB in bestehender Paperless-Instanz) |
| Auth | NextAuth.js (Credentials Provider, JWT Sessions) |
| KI-Transkription | Mistral Voxtral Mini (`voxtral-mini-latest`) |
| KI-Analyse | Mistral Large (`mistral-large-latest`) |
| Reverse Proxy | Traefik (Let's Encrypt, Domain: `transkription.helgeroos.de`) |
| Containerisierung | Docker (Multi-Stage Build, `output: 'standalone'`) |
| Design | Google Corporate Identity (Material Design, Inter Font) |

## Architektur

```
transkription_webapp/
├── components/          # React-Komponenten
│   ├── AudioUploadForm  # Drag-Drop Upload mit Optionen
│   ├── Layout           # Google-Style Seitenlayout
│   ├── Navbar           # Auth-aware Navigation
│   ├── StatusBadge      # Farbkodierte Status-Badges
│   ├── TranscriptionCard
│   └── LoadingSpinner
├── config/
│   ├── docker-compose.dev.yml   # Lokale Entwicklung (eigene PostgreSQL)
│   └── docker-compose.prod.yml  # Produktion (Traefik + Paperless-DB)
├── lib/
│   ├── ai-service.js    # Mistral API (Voxtral + Large)
│   ├── api.js           # Frontend API-Helper
│   ├── constants.js     # Status-Konstanten, Dateitypen
│   ├── db.js            # PostgreSQL Connection Pool
│   └── db-init.js       # Datenbankschema
├── pages/
│   ├── api/
│   │   ├── auth/[...nextauth].js  # NextAuth-Konfiguration
│   │   ├── auth/register.js       # Benutzerregistrierung
│   │   ├── transcriptions/        # CRUD + Workflow-Endpunkte
│   │   ├── upload.js              # Datei-Upload
│   │   ├── settings.js            # Benutzer-Einstellungen
│   │   ├── health.js              # Health-Check
│   │   └── db-init.js             # Schema-Initialisierung
│   ├── login.js
│   ├── register.js
│   ├── upload.js
│   ├── transcriptions.js
│   ├── transcriptions/[id].js
│   ├── settings.js
│   └── index.js
└── styles/globals.css
```

## Datenbankschema

```sql
users           (id, email, name, password_hash, role, created_at, updated_at)
api_keys        (id, user_id, key, name, created_at, expires_at)
transcriptions  (id, user_id, filename, original_name, file_path, file_size,
                 mime_type, status, template, diarize, custom_prompt,
                 text, segments, speakers, analysis, error, created_at, updated_at)
settings        (id, user_id, mistral_api_key, default_template, language,
                 context_bias, updated_at)
```

## Transkriptions-Workflow

### Ohne Sprechererkennung
```
Upload → pending → processing (Voxtral) → analyzing (Mistral Large) → completed
```

### Mit Sprechererkennung (diarize=true)
```
Upload → pending → processing (Voxtral) → transcribed
  → Benutzer weist Sprechernamen zu
  → analyzing (Mistral Large mit Sprechernamen) → completed
```

### Status-Übersicht

| Status | Bedeutung |
|---|---|
| `pending` | Hochgeladen, wartet auf Verarbeitung |
| `processing` | Voxtral Transkription läuft |
| `transcribed` | Transkription fertig, Sprecherzuweisung ausstehend |
| `analyzing` | Mistral Large Analyse läuft |
| `completed` | Abgeschlossen |
| `error` | Fehler aufgetreten |

## Features

### Implementiert

#### 1. Benutzerauthentifizierung
- Registrierung und Login (NextAuth.js, Credentials Provider)
- JWT Sessions, rollenbasierte Zugriffskontrolle
- Jeder Nutzer hinterlegt eigenen Mistral API-Key in den Einstellungen

#### 2. Audio-Upload
- Drag-Drop und Dateiauswahl
- Unterstützte Formate: MP3, WAV, OGG, FLAC, M4A, WebM
- Maximale Dateigröße: 50 MB
- Template-Auswahl (Meeting-Protokoll, Aufmaß, Allgemein)

#### 3. Sprechererkennung (Diarization)
- Optional aktivierbar beim Upload
- Voxtral erkennt verschiedene Sprecher und liefert `speaker_id` pro Segment
- Nach der Transkription können Sprechernamen zugewiesen werden
- Sprechernamen werden vor der Analyse in den Text eingefügt

#### 4. Kontextwörter (Context Bias)
- Benutzer kann in den Einstellungen eine kommagetrennte Liste von Begriffen hinterlegen
- Begriffe werden automatisch als `context_bias` an Voxtral gesendet
- Verbessert die Erkennung von Fachbegriffen, Eigennamen und Abkürzungen

#### 5. Zusätzlicher Kontext (Custom Prompt)
- Optionales Freitextfeld beim Upload
- Wird der Mistral Large Analyse als zusätzlicher Kontext mitgegeben
- Ermöglicht Angabe von Teilnehmern, Projektnamen, besonderen Hinweisen

#### 6. Template-basierte Analyse
- **Meeting-Protokoll**: Zusammenfassung, Themen, To-Dos mit Priorität und Verantwortlichen, Entscheidungen, offene Punkte, nächste Schritte
- **Aufmaß**: Projekt, Räume mit Elementen und Maßen, Plausibilitätswarnungen, Zusammenfassung
- **Allgemein**: Zusammenfassung, Kernpunkte, detaillierte Aufbereitung

#### 7. Google Material Design
- Google-Farbpalette (Blue, Red, Green, Yellow, Gray)
- Inter Font, Material Design Shadows
- Responsive Layout, Card-basierte Darstellung

### API-Endpunkte

| Methode | Pfad | Beschreibung |
|---|---|---|
| POST | `/api/auth/register` | Benutzerregistrierung |
| POST/GET | `/api/auth/[...nextauth]` | Login/Session |
| POST | `/api/upload` | Audio hochladen (diarize, customPrompt) |
| GET | `/api/transcriptions` | Liste der Transkriptionen |
| GET | `/api/transcriptions/[id]` | Detail einer Transkription |
| PATCH | `/api/transcriptions/[id]` | Sprechernamen zuweisen |
| DELETE | `/api/transcriptions/[id]` | Transkription löschen |
| POST | `/api/transcriptions/[id]/process` | Transkription starten |
| POST | `/api/transcriptions/[id]/analyze` | Analyse starten (nach Sprecherzuweisung) |
| GET/PUT | `/api/settings` | Benutzer-Einstellungen (API-Key, Template, Sprache, Context Bias) |
| GET | `/api/health` | Health-Check |
| POST | `/api/db-init` | Datenbankschema initialisieren |

## Implementierungsfortschritt

### Phase 1: Infrastruktur — Abgeschlossen
- [x] Dockerfile (Multi-Stage Build, node:18-alpine)
- [x] Docker Compose Dev (eigene PostgreSQL, Port 3000)
- [x] Docker Compose Prod (Traefik, paperless-internal Netzwerk)
- [x] .env.example, .gitignore, next.config.js

### Phase 2: Frontend — Abgeschlossen
- [x] Tailwind CSS mit Google-Farbpalette
- [x] Layout, Navbar (auth-aware)
- [x] Landing Page / Dashboard
- [x] Upload-Seite mit AudioUploadForm
- [x] Transkriptionsliste und Detailseite
- [x] Einstellungen-Seite
- [x] Login/Register-Seiten

### Phase 3: Backend — Abgeschlossen
- [x] PostgreSQL-Verbindung und Schema
- [x] NextAuth.js (Credentials, JWT)
- [x] Registrierung (bcryptjs)
- [x] Alle API-Routen (Upload, Transkriptionen, Settings, Health)

### Phase 4: KI-Integration — Abgeschlossen
- [x] Voxtral Mini via `/audio/transcriptions` (Multipart Upload)
- [x] Mistral Large via `/chat/completions` (JSON Response)
- [x] Template-spezifische Prompts (Meeting, Aufmaß, Allgemein)
- [x] Sprechererkennung (diarize, timestamp_granularities)
- [x] Kontextwörter (context_bias)
- [x] Zwei-Schritt-Workflow (Sprecherzuweisung)
- [x] Custom Prompt (zusätzlicher Kontext)

### Phase 5: Ausstehend
- [ ] Docker Build lokal testen
- [ ] Login/Register Frontend-Integration testen
- [ ] Frontend an echte API-Routen anbinden (E2E Test)
- [ ] Mistral API mit echtem Key testen
- [ ] VPS Deployment vorbereiten
- [ ] package-lock.json generieren (via Docker)

## VPS-Deployment

### Zielumgebung
- **Hoster**: Hetzner (fsn1), Ubuntu, 8 GB RAM, 75 GB HDD
- **Docker**: 27.5.1
- **Reverse Proxy**: Traefik (bereits aktiv, Let's Encrypt)
- **Domain**: `transkription.helgeroos.de`
- **DB**: Eigene Datenbank in bestehender Paperless-PostgreSQL (postgres:16)
- **Netzwerke**: `web` (extern, Traefik), `paperless-internal` (DB-Zugriff)

### Voraussetzungen
- Docker Compose Plugin installieren: `apt install docker-compose-plugin`
- Speicherplatz bereinigen: `docker system prune` (91% belegt)
- Bestehende Dienste: Immich, Paperless-ngx, Nextcloud, Watchtower

---

**Letzte Aktualisierung**: 07.02.2026
**Status**: Phase 1–4 abgeschlossen, Phase 5 (Testing & Deployment) ausstehend
