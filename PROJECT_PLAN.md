# GhostTyper Projektplan

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
| KI-Analyse | Mistral Large/Medium/Small (pro Job wählbar) |
| KI-OCR | Mistral OCR (`mistral-ocr-latest`) |
| KI-Übersetzung | Mistral Modelle (pro Job wählbar) |
| Reverse Proxy | Traefik (Let's Encrypt, Domain: `transkription.helgeroos.de`) |
| Containerisierung | Docker (Multi-Stage Build, `output: 'standalone'`) |
| Design | Dark Theme (#0a0a0f, Mistral Orange #ff5917) |

## Architektur

```
transkription_webapp/
├── components/          # React-Komponenten
│   ├── AudioUploadForm  # Upload mit Modell- und Template-Wahl
│   ├── AudioRecorder    # In-App Audio-Aufnahme (.webm/Opus)
│   ├── Layout           # Seitenlayout mit Sidebar & mobilem Header
│   ├── Sidebar          # Vertikale Navigation (reorganisiert)
│   ├── DocumentEditor   # Canvas-Editor mit Rich-Text Toolbar & .docx Export
│   ├── StatusBadge      # Farbkodierte Status-Badges
│   └── LoadingSpinner
├── config/
│   ├── docker-compose.dev.yml   # Lokale Entwicklung (eigene PostgreSQL)
│   └── docker-compose.prod.yml  # Produktion (Traefik + Paperless-DB)
├── lib/
│   ├── ai-service.js    # Mistral API Integration
│   ├── api.js           # Frontend API-Helper
│   ├── export-utils.js  # Markdown-zu-HTML & PDF/DOCX Export
│   ├── prompts.js       # Zentralisierte KI-Anweisungen (Zusammenfassung, Meeting, Aufmaß)
│   ├── constants.js     # Status-Konstanten, Dateitypen
│   ├── db.js            # PostgreSQL Pool & Template-Resolver
│   ├── db-init.js       # Datenbankschema & Migrationen
│   ├── admin.js         # Admin-Middleware
│   └── usage.js         # Token/Kosten-Tracking in €
├── pages/
│   ├── api/             # API Endpunkte (Auth, Profile, Transcriptions, OCR, Translate, Settings, Admin)
│   ├── login.js         # Branding-optimierte Login-Seite
│   ├── upload.js        # Hauptseite für Transkription
│   ├── translate.js     # Modulares Übersetzungs-Tool (inkl. OCR-Import)
│   ├── ocr.js           # Dokumentenerkennung mit Canvas-Integration
│   ├── profile.js       # Benutzerprofil (Avatar-Upload, E-Mail, Passwort)
│   ├── transcriptions.js # Historie (Audio & OCR kombiniert)
│   ├── settings.js      # Einstellungen & Canvas Template-Editor
│   └── admin/           # Admin-User-Verwaltung
└── styles/globals.css   # Dark-Theme & Branding-Styles
```

## Datenbankschema (Updates)
- `transcriptions`: Spalten `document_html` (korrigierte Fassung) und `model` (gewähltes LLM).
- `settings`: Spalte `cost_limit` (monatliches Limit in €).
- `templates`: Tabelle für benutzerdefinierte & überschriebene Analyse-Prompts.
- `users`: Spalte `avatar_url` für Profilbilder (Base64).

## Features

### Implementiert

#### 1. Branding & Design (F1, F12)
- Systemweites Redesign auf **Mistral Orange** (#ff5917).
- Neues Logo mit schwarzem Hintergrund, Favicon und PWA-Icons integriert.
- Konsistente Benennung der KI-Modelle ("Mistral Large" etc.).

#### 2. Transkription & Audio (F5, F6)
- Hochpräzise Audio-Umwandlung mit Voxtral Mini.
- In-App Aufnahme (.webm) mit direktem API-Mapping.
- Modellauswahl (Large/Medium/Small) direkt beim Start des Jobs.

#### 3. OCR & Document AI (F4) — ERWEITERT
- Textextraktion aus PDF/Bildern mit automatischer Speicherung in der Historie.
- 2-Schritt-Feedback: "Text-Extraktion" -> "KI-Analyse".
- Flexible Analyse mit wählbaren Templates und Custom Prompts.

#### 4. Dokumenten-Workflow (F14) — CANVAS
- **Canvas Editor:** WYSIWYG-Umgebung im Gemini-Stil mit Rich-Text Toolbar (Fett, Kursiv, Unterstreichen, Listen, Ausrichtung, H2/H3).
- **Referenz-Sidebar:** Originaltext bleibt beim Bearbeiten links sichtbar.
- **Clean Export:** PDF- und professioneller **DOCX-Export** (via `docx` Library) ohne Website-Metadaten.
- **Markdown-Fix:** Automatische Umwandlung von KI-Strukturen/Markdown in formatierten Text.

#### 5. Übersetzungs-Modul (F3)
- Zwischen-Übersetzung von OCR- oder Audio-Texten direkt im Canvas-Editor.
- Dediziertes Tool mit **OCR-Import-Funktion** (Text aus Foto/PDF extrahieren und übersetzen).

#### 6. Profil-Management (NEU)
- Direktes Hochladen von Profilbildern (Galerie/Explorer) mit Base64-Speicherung.
- Änderung von Name, E-Mail und Passwort (mit Sicherheits-Verifizierung des alten Passworts).

#### 7. Admin & Kostenkontrolle (F7, F8, F9)
- Benutzerverwaltung und individuelle monatliche Kostenlimits in €.
- Statische Preisliste in den Einstellungen integriert.

## Implementierungsfortschritt

### Phasen 1 bis 11 — Abgeschlossen
- Alle Kernfeatures, Sicherheitsaspekte und Design-Anpassungen umgesetzt.
- Stabilität der KI-Anzeige durch typsicheres Rendering gewährleistet.
- Rebranding auf Mistral Orange abgeschlossen.
- Professionelle Export-Engine für DOCX und PDF integriert.
- **Fix (Aktuell):** Radikaler PDF-Export-Fix (keine Browser-Header mehr, korrekte Listen-Formatierung).

### Phase 12: Deployment & Finalisierung — In Arbeit
- [x] Lokale Docker-Umgebung stabilisiert.
- [x] Datenbank-Migrationspfad via `/api/db-init` etabliert.
- [x] Finaler E2E-Test aller Module abgeschlossen.
- [ ] Vorbereitung VPS-Deployment.
