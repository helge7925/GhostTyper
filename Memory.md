# GhostTyper - Project Memory

## Project Overview

**GhostTyper** ist eine sichere, selbstgehostete KI-Webapp für Audio-Transkription, OCR, Textanalyse und strukturierte Datenextraktion.

### Aktuelle Version: 0.3.0

---

## System Architecture

| Component | Technology |
|-----------|-----------|
| Frontend | Next.js 15.5.x (Pages Router), React 18, Tailwind CSS 3 |
| Backend | Next.js API Routes |
| Authentication | NextAuth Credentials + JWT |
| Database | PostgreSQL 16 |
| AI Models | Mistral AI (Large, Medium, Small, Voxtral, OCR) |
| Deployment | Docker Compose + Traefik |

---

## Core Features

### Audio Processing
- **Transcription**: Mistral Voxtral Mini für schnelle, präzise Spracherkennung
- **Diarization**: Sprecher-Erkennung und -Trennung
- **In-App Recording**: Direkte Audio-Aufnahme im Browser (.webm)
- **Context Bias**: Benutzerdefinierte Fachbegriffe für bessere Erkennung

### Text Analysis
- **AI Models**: Wählbar pro Job (Large/Medium/Small)
- **Custom Templates**: Benutzerdefinierte Analyse-Vorlagen
  - **Text Templates**: Freie Textanalyse mit JSON-Output
  - **Table Templates**: Strukturierte Datenextraktion (v1.1.0)
  - **Template Categories**: Organisation in selbst erstellten Kategorien (v1.2.0)
  - **Knowledge Graph**: Extrahiert und visualisiert Entitäten und Relationen (vis-network)
- **Language Support**: DE, EN, FR, ES, IT

### Table Extraction (v1.1.0)
- **Visual Schema Builder**: Drag & Drop Spalten-Editor
- **Data Types**: Text, Number, Currency, Date
- **Calculated Fields**: Formeln wie `menge * preis`
- **Inline Editing**: Bearbeitung nach KI-Extraktion
- **Export Options**: CSV, Excel (XLSX), HTML
- **AI Generation**: Schema-Vorschläge aus Beschreibungen

### Search (v1.2.0)
- **Full-Text Search**: Durchsucht Transkripte und Analysen
- **Server-Side**: PostgreSQL ILIKE für case-insensitive Suche
- **Debounced Input**: Live-Suche mit 300ms Verzögerung

### Document Processing
- **OCR**: Mistral OCR für PDFs und Bilder
- **WYSIWYG Editor**: Rich-Text editing mit Format-Toolbar
- **Export**: PDF (serverseitig), DOCX, Text
- **Translation**: Integrierte KI-Übersetzung

### Admin Features
- **User Management**: Admin-only User Creation
- **Cost Tracking**: Verbrauch in € mit monatlichem Limit
- **API Key Management**: Verschlüsselte Speicherung
- **Observability**: Logs und Metriken

---

## Technical Stack

### Frontend
- Next.js 15.5.x with Pages Router
- React 18 with Hooks
- Tailwind CSS 3 with custom theme
- next-auth for Authentication

### Backend
- Next.js API Routes
- PostgreSQL with connection pooling
- SSE for real-time updates
- Queue-based job processing

### AI Integration
- Mistral AI API
- Dynamic model selection
- Cost tracking per request

### Security
- bcryptjs for password hashing
- AES encryption for API keys
- Rate limiting on all endpoints
- DOMPurify for XSS protection

---

## Database Schema

### Core Tables
- `users`: Benutzerkonten mit Rollen
- `transcriptions`: Audio-Transkriptionen
- `templates`: Analyse-Vorlagen (text/table) mit Kategorie-Zuordnung
- `template_categories`: Kategorien für Vorlagen (v1.2.0)
- `settings`: Benutzer-Einstellungen
- `usage_log`: Kosten-Tracking

### Key Columns
- `templates.template_type`: 'text' | 'table'
- `templates.table_schema`: JSONB für Tabellen-Definition
- `templates.category_id`: Foreign Key zu template_categories (v1.2.0)
- `transcriptions.analysis_type`: 'text' | 'table'
- `transcriptions.table_schema`: Referenz zum Schema

### Template Categories (v1.2.0)
```sql
CREATE TABLE template_categories (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(20) DEFAULT '#f97316',
  position INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

---

## Project Structure

```
/Users/helgeroos/Documents/GitHub/transkription_webapp/
├── components/
│   ├── TableSchemaBuilder.js    # Tabellen-Schema Editor
│   ├── TableRenderer.js          # Interaktive Tabelle
│   ├── DocumentEditor.js         # WYSIWYG Editor
│   ├── Layout.js, Sidebar.js     # UI Layout
│   └── ...
├── lib/
│   ├── table-calculations.js     # Formel-Berechnungen
│   ├── table-export.js           # Export-Funktionen
│   ├── table-template-generator.js
│   ├── db.js, db-init.js         # Database
│   ├── ai-service.js             # Mistral API
│   └── ...
├── pages/
│   ├── api/                      # Backend Endpoints
│   ├── settings.js               # Einstellungen
│   ├── transcriptions/
│   │   └── [id].js               # Detailansicht
│   └── ...
├── styles/
└── config/
    └── docker-compose.{dev,prod}.yml
```

---

## Feature Implementation Status

### Phase 1: Foundation ✅
- [x] Basic transcription with Mistral
- [x] User authentication
- [x] File upload and processing

### Phase 2: Enhancement ✅
- [x] Speaker diarization
- [x] Custom analysis templates
- [x] Document editor with export

### Phase 3: Scale & Polish ✅
- [x] Queue-based processing
- [x] Real-time status updates
- [x] Admin dashboard

### Phase 4: Table Extraction ✅ (v1.1.0)
- [x] Table template schema
- [x] Visual schema builder
- [x] Calculated fields
- [x] Export to CSV/Excel
- [x] Inline editing

### Phase 5: Organization & Search ✅ (v1.2.0)
- [x] Template categories (CRUD)
- [x] Full-text search in transcriptions
- [x] Server-side search with debouncing

---

## Dependencies

### Production
- next, react, react-dom
- pg (PostgreSQL)
- next-auth
- axios
- xlsx (Excel export)
- docx (Word export)
- dompurify, marked
- vis-network, vis-data (Knowledge Graph)

### Development
- tailwindcss
- eslint
- postcss, autoprefixer

---

## Deployment

### Development
```bash
docker compose -f config/docker-compose.dev.yml up --build -d
curl -X POST http://localhost:3000/api/db-init \
  -H "x-init-secret: dev-db-init-secret"
```

### Production
- Docker Compose with Traefik
- Let's Encrypt SSL
- Environment variables for secrets
- Volume mounts for uploads

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for detailed version history.

### Latest: v0.3.0
**Major Feature**: Public beta baseline with remote-meeting capture,
workspace/org scoping, table extraction, audit logging and encrypted
provider configuration.

### Previous: v1.0.1
- iOS upload fixes
- Editor improvements
- PDF/DOCX export fixes

### v1.0.0
- Initial stable release
- All core features implemented
- Production ready

---

## Development Notes

### Adding New Features
1. Update database schema in `lib/db-init.js`
2. Create/modify API endpoints in `pages/api/`
3. Build UI components in `components/`
4. Add business logic in `lib/`
5. Update settings page if needed
6. Run `npm run lint` before commit

### Code Standards
- ESLint: No warnings or errors
- Functional React components with Hooks
- Async/await for API calls
- Error boundaries for stability

---

## License & Copyright

GhostTyper © 2026 Helge Roos
Private project - All rights reserved
