# Transkriptions-WebApp Projektplan

## Übersicht
Web-Anwendung für Audio-Transkription, OCR/Document AI und KI-gestützte Analyse. Nutzt Mistral Voxtral Mini für die Transkription, Mistral OCR für Dokumentenerkennung und Mistral Large/Medium/Small für kontextsensitive Analyse und Übersetzung. Deployment auf einem Hetzner VPS mit Docker und Traefik.

## Technologiestack

| Komponente | Technologie |
|---|---|
| Frontend | Next.js 13 (Pages Router), React 18, Tailwind CSS 3 |
| Backend | Next.js API Routes |
| Datenbank | PostgreSQL 16 (eigene DB in bestehender Paperless-Instanz) |
| Auth | NextAuth.js (Credentials Provider, JWT Sessions) |
| KI-Transkription | Mistral Voxtral Mini (`voxtral-mini-latest`) |
| KI-Analyse | Mistral Large/Medium/Small (wählbar pro User) |
| KI-OCR | Mistral OCR (`mistral-ocr-latest`) |
| KI-Übersetzung | Mistral Large (`mistral-large-latest`) |
| Reverse Proxy | Traefik (Let's Encrypt, Domain: `transkription.helgeroos.de`) |
| Containerisierung | Docker (Multi-Stage Build, `output: 'standalone'`) |
| Design | Dark Theme (#0a0a0f, Accent Purple/Cyan) |

## Architektur

```
transkription_webapp/
├── components/          # React-Komponenten
│   ├── AudioUploadForm  # Drag-Drop Upload mit Optionen
│   ├── AudioRecorder    # In-App Audio-Aufnahme (geplant)
│   ├── Layout           # Seitenlayout mit Sidebar (Dark Theme)
│   ├── Sidebar          # Vertikale Navigation (geplant, ersetzt Navbar)
│   ├── StatusBadge      # Farbkodierte Status-Badges
│   ├── TemplateEditor   # Vorlagen-Editor in Settings (geplant)
│   ├── TranscriptionCard
│   └── LoadingSpinner
├── config/
│   ├── docker-compose.dev.yml   # Lokale Entwicklung (eigene PostgreSQL)
│   └── docker-compose.prod.yml  # Produktion (Traefik + Paperless-DB)
├── lib/
│   ├── ai-service.js    # Mistral API (Voxtral + Large + OCR)
│   ├── api.js           # Frontend API-Helper
│   ├── constants.js     # Status-Konstanten, Dateitypen
│   ├── db.js            # PostgreSQL Connection Pool
│   ├── db-init.js       # Datenbankschema
│   └── admin.js         # Admin-Middleware (geplant)
├── pages/
│   ├── api/
│   │   ├── auth/[...nextauth].js  # NextAuth-Konfiguration
│   │   ├── auth/register.js       # Benutzerregistrierung (nur Admin)
│   │   ├── transcriptions/        # CRUD + Workflow-Endpunkte
│   │   ├── upload.js              # Datei-Upload (Audio + Dokumente)
│   │   ├── translate.js           # Übersetzungs-API (geplant)
│   │   ├── ocr.js                 # OCR-API (geplant)
│   │   ├── settings.js            # Benutzer-Einstellungen
│   │   ├── admin/                 # Admin-API-Routes (geplant)
│   │   ├── health.js              # Health-Check
│   │   └── db-init.js             # Schema-Initialisierung
│   ├── login.js
│   ├── upload.js
│   ├── translate.js               # Übersetzungs-Seite (geplant)
│   ├── ocr.js                     # OCR/Document AI-Seite (geplant)
│   ├── transcriptions.js
│   ├── transcriptions/[id].js
│   ├── settings.js
│   ├── admin/                     # Admin-Seiten (geplant)
│   └── index.js
└── styles/globals.css
```

## Datenbankschema

```sql
users           (id, email, name, password_hash, role, created_at, updated_at)
                -- role: 'admin' oder 'user' (keine Selbstregistrierung, nur Admin erstellt User)
api_keys        (id, user_id, key, name, created_at, expires_at)
transcriptions  (id, user_id, filename, original_name, file_path, file_size,
                 mime_type, status, template, diarize, custom_prompt,
                 output_language, skip_analysis,
                 text, segments, speakers, analysis, error, created_at, updated_at)
                -- output_language: 'de'/'en' — Sprache des Analyse-Dokuments
                -- skip_analysis: true = nur Transkription/OCR, keine LLM-Analyse
settings        (id, user_id, mistral_api_key, default_template, language,
                 preferred_model, cost_limit, context_bias, updated_at)
                -- preferred_model: 'mistral-large-latest'/'mistral-medium-latest'/'mistral-small-latest'
                -- cost_limit: monatliches Kostenlimit in EUR (NULL = unbegrenzt)
usage_log       (id, user_id, model, operation, input_tokens, output_tokens,
                 estimated_cost, created_at)
                -- operation: 'transcription'/'analysis'/'translation'/'ocr'
                -- Tracking pro API-Call für Kostenkontrolle
templates       (id, user_id, name, prompt_text, created_at, updated_at)
                -- Benutzerdefinierte Verarbeitungsvorlagen
                -- prompt_text wird als System-Prompt an Mistral gesendet
```

## Workflows

### Audio-Transkription

#### Ohne Sprechererkennung
```
Upload/Aufnahme → pending → processing (Voxtral) → analyzing (Mistral Large) → completed
```

#### Mit Sprechererkennung (diarize=true)
```
Upload/Aufnahme → pending → processing (Voxtral) → transcribed
  → Benutzer weist Sprechernamen zu
  → analyzing (Mistral Large mit Sprechernamen) → completed
```

#### Nur Transkription (skip_analysis=true)
```
Upload/Aufnahme → pending → processing (Voxtral) → completed (nur Rohtext)
```

### OCR/Document AI
```
Upload/Foto → Mistral Files API → Signed URL → mistral-ocr-latest → Markdown-Text
  → Optional: Weiterverarbeitung mit Mistral Large (Zusammenfassung, Analyse)
  → Datei bei Mistral löschen
```

### Übersetzung
```
Text eingeben → Quellsprache + Zielsprache wählen → Mistral Large → Übersetzter Text
```

### Status-Übersicht

| Status | Bedeutung |
|---|---|
| `pending` | Hochgeladen, wartet auf Verarbeitung |
| `processing` | Voxtral Transkription / OCR läuft |
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

#### 7. Dark Theme Design
- Dark Theme (#0a0a0f bg, #6c5ce7 accent-purple, #00cec9 accent-cyan)
- Responsive Layout, Card-basierte Darstellung

### Geplant

#### 8. Ausgabesprache für Analyse-Dokumente (F2)
- Vor der Transkription wählbar: Deutsch oder Englisch
- Betrifft die Sprache des Analyse-Prompts an Mistral Large (nicht die Audiosprache bei Voxtral)
- Dropdown im Upload-Formular, Parameter an `analyzeTranscription()` übergeben

#### 9. Trennung Transkription/Weiterverarbeitung (F5)
- Optional nur Transkription (Voxtral) ohne anschließende Analyse (Mistral Large)
- Ebenso bei OCR: nur Text extrahieren ohne LLM-Verarbeitung
- Toggle im Upload-Formular ("Nur Transkription" vs. "Transkription + Analyse")

#### 10. In-App Audio-Aufnahme (F6)
- Direkt in der App Audio aufnehmen statt nur hochladen
- `MediaRecorder` Web API, funktioniert in allen modernen Browsern + Mobile
- Neue Komponente `AudioRecorder.js` mit Start/Stop/Pause, Timer
- Erzeugt WebM/OGG Blob → wird wie normaler Upload behandelt

#### 11. Übersetzungs-Modul (F3)
- Separater Tab/Seite (`/translate`)
- Text direkt einfügen, Quellsprache + Zielsprache auswählen
- Übersetzung via Mistral Large `/chat/completions`

#### 12. OCR/Document AI (F4)
- Separater Tab/Seite (`/ocr`)
- Zwei Eingabemodi: Datei-Upload (PDF, DOCX, Bilder) und Kamera-Foto (Mobilgerät)
- Workflow: Upload → Mistral Files API → Signed URL → `mistral-ocr-latest` → Markdown
- Trennung OCR (nur Text) vs. LLM-Verarbeitung (Analyse/Zusammenfassung)
- Tabellen-Format konfigurierbar (null/markdown/html)

#### 13. Admin-System (F7, F8)
- Admin-User wird einmalig per Seed-Script erstellt
- Keine Selbstregistrierung — nur Admin kann User anlegen
- Admin-Seiten: `/admin/users` (Liste, Erstellen, Bearbeiten, Löschen)
- Admin kann pro User: Name, E-Mail, Passwort, Rolle, API-Key setzen
- Middleware `requireAdmin()` für Admin-API-Routes

#### 14. Token/Kostenzähler mit Limit (F9)
- Tracking der API-Nutzung pro User (Tokens, geschätzte Kosten)
- Neue DB-Tabelle `usage_log`
- Mistral `usage`-Feld aus Responses auswerten
- Kosten pro Modell berechnen (Preisliste Mistral)
- Admin kann monatliche Limits pro User setzen
- User sieht eigene Kosten, Admin sieht alle

#### 15. Modellauswahl (F10)
- User kann in Einstellungen zwischen Mistral Large, Medium und Small wählen
- Neues Feld `preferred_model` in Settings-Tabelle
- Betrifft Analyse und Übersetzung (nicht Transkription — bleibt Voxtral)

#### 16. Individuelle Verarbeitungsvorlagen (F11)
- User kann eigene Formatierungs-/Verarbeitungsvorlagen in den Einstellungen anlegen und bearbeiten
- Vorlagen enthalten Name und Prompt-Text (z.B. für Aufmaß, Meeting, Bauabnahme, Arztbericht etc.)
- Neue DB-Tabelle `templates` (id, user_id, name, prompt_text, created_at, updated_at)
- CRUD-API-Routes: `/api/templates` (GET, POST), `/api/templates/[id]` (PUT, DELETE)
- Vorlagen-Editor in den Einstellungen mit Erstellen/Bearbeiten/Löschen
- Beim Upload werden die eigenen Vorlagen als Template-Auswahl angezeigt (zusätzlich zu den 3 Standard-Templates)
- Gewählte Vorlage wird als System-Prompt an Mistral Large/Medium/Small gesendet
- Die bisherigen 3 Standard-Templates (Meeting, Aufmaß, Allgemein) bleiben als nicht-löschbare Defaults bestehen

#### 17. Logo-Integration (F12)
- Zwei PNG-Dateien vorhanden: Logo mit Schriftzug und Logo ohne Schriftzug
- Logo ohne Schriftzug in der Sidebar/Navbar verwenden
- Logo mit Schriftzug auf der Login-Seite und Landing Page verwenden
- **WICHTIG**: Logo-Hintergrund muss transparent sein oder zu `#0a0a0f` passen (aktuell ~#3a3a44, zu hell)
- Logos in `/public/` ablegen als `logo.png` und `logo-text.png`

#### 18. Vertikale Sidebar-Navigation (F13)
- Navigation von horizontaler Tab-Leiste auf vertikale Sidebar links umstellen
- **Desktop**: Permanente Sidebar (~240px breit) mit Logo, Nav-Links, User-Info, Abmelden
- **Mobile**: Off-Canvas-Sidebar, per Swipe-Right einblendbar (Touch-Events: touchstart/touchmove/touchend)
- Hamburger-Button oben links als zusätzlicher Auslöser auf Mobile
- Content-Bereich nutzt auf Desktop die verbleibende Breite → weniger "leeres" Gefühl
- Auf Mobile bleibt volle Breite erhalten, Sidebar gleitet als Overlay ein
- Umstellung betrifft: `Layout.js`, `Navbar.js` (wird zu `Sidebar.js`), alle Seiten-Container
- CSS-Transitions für sanfte Animation, kein externes Framework nötig

### API-Endpunkte

#### Bestehend
| Methode | Pfad | Beschreibung |
|---|---|---|
| POST | `/api/auth/register` | Benutzerregistrierung (nur Admin) |
| POST/GET | `/api/auth/[...nextauth]` | Login/Session |
| POST | `/api/upload` | Audio/Dokument hochladen |
| GET | `/api/transcriptions` | Liste der Transkriptionen |
| GET | `/api/transcriptions/[id]` | Detail einer Transkription |
| PATCH | `/api/transcriptions/[id]` | Sprechernamen zuweisen |
| DELETE | `/api/transcriptions/[id]` | Transkription löschen |
| POST | `/api/transcriptions/[id]/process` | Transkription starten |
| POST | `/api/transcriptions/[id]/analyze` | Analyse starten |
| GET/PUT | `/api/settings` | Benutzer-Einstellungen |
| GET | `/api/health` | Health-Check |
| POST | `/api/db-init` | Datenbankschema initialisieren |

#### Geplant
| Methode | Pfad | Beschreibung |
|---|---|---|
| POST | `/api/translate` | Text-Übersetzung via Mistral Large |
| POST | `/api/ocr` | OCR via Mistral OCR (Upload → Text) |
| GET | `/api/templates` | Eigene Vorlagen auflisten |
| POST | `/api/templates` | Neue Vorlage erstellen |
| PUT | `/api/templates/[id]` | Vorlage bearbeiten |
| DELETE | `/api/templates/[id]` | Vorlage löschen |
| GET | `/api/admin/users` | User-Liste (nur Admin) |
| POST | `/api/admin/users` | User erstellen (nur Admin) |
| PUT | `/api/admin/users/[id]` | User bearbeiten (nur Admin) |
| DELETE | `/api/admin/users/[id]` | User löschen (nur Admin) |
| GET | `/api/admin/usage` | Kostenübersicht aller User (nur Admin) |
| GET | `/api/usage` | Eigene Kostenübersicht |

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

### Phase 5: Bugfixes & Quick Wins — Abgeschlossen
- [x] B1: Settings speichern Bug fixen (try/catch + Error Handling)
- [x] B2: Empty-State Upload-Link in Historie entfernen
- [x] B3: Landing Page — eingeloggte User direkt zum Upload (/upload Redirect)
- [x] F1: Tagline → "Your thought, decoded and distilled."
- [x] F10: Modellauswahl (Mistral Large/Medium/Small) in Settings + DB + API + Backend

### Phase 6: Admin & Auth — Abgeschlossen
- [x] F7: Admin-System (Seed-Script, Admin-Seiten, Middleware, Selbstregistrierung deaktiviert)
- [x] F8: Admin kann API-Keys + Kostenlimits pro User hinterlegen
- [x] F9: Token/Kostenzähler (usage_log Tabelle, Tracking, Limits, User + Admin Dashboard)

### Phase 7: Audio-Erweiterungen — Ausstehend
- [ ] F2: Ausgabesprache (DE/EN) für Analyse-Dokumente
- [ ] F5: Trennung Transkription/Weiterverarbeitung (nur Transkript ohne Analyse)
- [ ] F6: In-App Audio-Aufnahme (MediaRecorder API)
- [ ] B4: Speaker Assignment Popup/Benachrichtigung

### Phase 8: UI-Überarbeitung & Logo — Ausstehend
- [ ] F13: Vertikale Sidebar-Navigation (Desktop permanent, Mobile Swipe-Geste)
- [ ] F12: Logo-Integration (transparente PNGs, Sidebar + Login-Seite)

### Phase 9: Individuelle Vorlagen — Ausstehend
- [ ] F11: Verarbeitungsvorlagen (DB-Tabelle, CRUD-API, Vorlagen-Editor in Settings, Upload-Integration)

### Phase 10: Neue Module — Ausstehend
- [ ] F3: Übersetzungs-Modul (Seite + API + Nav-Eintrag)
- [ ] F4: OCR/Document AI (Mistral OCR, Upload + Kamera, Seite + API)

### Phase 11: Testing & Deployment — Ausstehend
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

**Letzte Aktualisierung**: 09.02.2026
**Status**: Phase 1–6 abgeschlossen, Phase 7–11 ausstehend (1 Bug, 7 Features geplant)
