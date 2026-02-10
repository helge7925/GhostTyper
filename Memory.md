# GhostTyper (ehemals Transkription WebApp) - Project Memory

## Project Setup
- **App-Name:** GhostTyper (Rebranding abgeschlossen)
- **Framework:** Next.js 13 (Pages Router), React 18
- **Styling:** Tailwind CSS 3, Dark Theme (#0a0a0f bg, #6c5ce7 accent-purple, #00cec9 accent-cyan)
- **DB:** PostgreSQL (via Docker Compose)
- **Auth:** NextAuth mit Credentials Provider, JWT Sessions
- **Dependencies:** axios, pg, next-auth, bcryptjs, formidable
- **PWA:** manifest.json + Icons vorhanden

## Environment (lokal)
- Node.js/npm is NOT installed — builds/npm install via Docker (`node:18-alpine`)
- Docker setup uses multi-stage build with `output: 'standalone'`
- **Git Push:** Keine Authentifizierung für Claude — User pushed selbst

## VPS Deployment (docs/umgebungsanalyse.md)
- **Hoster:** Hetzner (fsn1), Ubuntu, 8GB RAM, 75GB HDD
- **Docker:** 27.5.1 — Docker Compose via Plugin
- **Reverse Proxy:** Traefik, Let's Encrypt, externes Netzwerk `web`
- **Domain:** `transkription.helgeroos.de` (via Traefik-Labels)
- **DB-Plan:** Eigene DB in bestehender Paperless-PostgreSQL-Instanz (postgres:16)

## Architecture
- `pages/` for routing (Pages Router, not App Router)
- `components/` for reusable UI components
- `lib/` for utilities (db.js, ai-service.js, api.js, constants.js)
- `config/` for Docker Compose files (dev + prod)
- `pages/api/` for backend API routes

## AI Models (IMPORTANT)
- **Transcription:** `voxtral-mini-latest` via `/audio/transcriptions` (multipart form upload)
- **Analysis:** `mistral-large-latest` (oder medium/small per User-Setting) via `/chat/completions`
- **OCR:** `mistral-ocr-latest` via Files API + `/ocr/process` (geplant)
- NEVER use pixtral — that's for vision, not audio

## Key Files
- `lib/db.js` — PostgreSQL connection pool
- `lib/db-init.js` — Schema (users, api_keys, transcriptions, settings, usage_log)
- `lib/ai-service.js` — Mistral API (Transcription + Analysis, DE/EN Prompts)
- `lib/api.js` — Frontend helpers
- `lib/admin.js` — Admin-Middleware (requireAdmin)
- `lib/usage.js` — Token/Kosten-Tracking
- `pages/api/settings.js` — GET/PUT for user settings
- `components/AudioUploadForm.js` — Upload + Aufnahme (Tab-System)
- `components/AudioRecorder.js` — MediaRecorder API Komponente
- `components/Toast.js` — Toast-Notification Komponente

## Known Bugs / Open Issues (see bugs.md for full details)

### Bugs (4) — alle behoben
- ~~B1: Settings speichern wirft Fehler (API-Key + Einstellungen)~~ — Phase 5
- ~~B2: Historie zeigt noch Upload-Button (Empty-State CTA)~~ — Phase 5
- ~~B3: Landing Page zeigt Dashboard-Cards statt direkt Upload~~ — Phase 5
- ~~B4: Kein Popup/Benachrichtigung für Sprecherzuweisung~~ — Phase 7

### Feature Requests (13) — 10 umgesetzt, 6 geplant
- ~~F1: Tagline → "Your thought, decoded and distilled."~~ — Phase 5
- ~~F2: Ausgabesprache DE/EN für Analyse-Dokumente~~ — Phase 7
- F3: Übersetzungs-Reiter (Text → Mistral Large → Übersetzung)
- F4: OCR/Document AI (Mistral OCR, Upload + Kamera)
- ~~F5: Trennung Transkription/Weiterverarbeitung~~ — Phase 7
- ~~F6: In-App Audio-Aufnahme (MediaRecorder API)~~ — Phase 7
- ~~F7: Admin-System (User-Verwaltung, keine Selbstregistrierung)~~ — Phase 6
- ~~F8: Admin kann API-Keys für Nutzer hinterlegen~~ — Phase 6
- ~~F9: Token/Kostenzähler mit Limit~~ — Phase 6
- ~~F10: Modellauswahl (Mistral Large/Medium/Small)~~ — Phase 5
- F11: Individuelle Verarbeitungsvorlagen (DB `templates`, CRUD, Settings-Editor)
- F12: Logo-Integration (PNGs mit/ohne Schriftzug, Hintergrund muss passen)
- F13: Vertikale Sidebar-Navigation (Desktop permanent, Mobile Swipe-Right)

### Phasen-Plan
- **Phase 5**: B1, B2, B3, F1, F10 — Bugfixes & Quick Wins — **ABGESCHLOSSEN**
- **Phase 6**: F7, F8, F9 — Admin & Auth — **ABGESCHLOSSEN**
- **Phase 7**: F2, F5, F6, B4 — Audio-Erweiterungen — **ABGESCHLOSSEN**
- **Phase 8**: F13, F12 — UI-Überarbeitung & Logo
- **Phase 9**: F11 — Individuelle Vorlagen
- **Phase 10**: F3, F4 — Neue Module (Übersetzung, OCR)
- **Phase 11**: Testing & Deployment
