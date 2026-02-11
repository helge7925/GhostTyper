# GhostTyper - Project Memory

## Project Setup
- **App-Name:** GhostTyper
- **Status:** Funktionsfähig & Vollständig (Phasen 1-11 abgeschlossen)
- **Framework:** Next.js 13 (Pages Router), React 18, Tailwind CSS 3
- **DB:** PostgreSQL 16 (via Docker)
- **Auth:** NextAuth mit Credentials Provider, Admin-only User-Creation

## Core Features
- **Audio:** Transkription (Voxtral Mini), Diarization, In-App Aufnahme (.webm).
- **Analysis:** Mistral Large/Medium/Small (pro Job wählbar), Custom Templates, Custom Prompts.
- **Document Workflow:** Canvas WYSIWYG Editor mit Rich-Text Toolbar, Export als PDF & professionelles **DOCX**.
- **OCR:** Mistral OCR für PDF & Bilder, inkl. Kamera-Integration und automatischer Historien-Speicherung.
- **Translation:** Dediziertes Modul mit OCR-Import & In-Editor Live-Übersetzung.
- **Admin:** Kosten-Tracking in €, monatliche Limits pro User, Preisliste.

## UI & UX
- **Design:** Dark Theme (#0a0a0f), Mistral Orange Akzente (#ff5917).
- **Navigation:** Vertikale Sidebar (Reorganisiert: Transkription -> Übersetzung -> OCR -> Historie).
- **Branding:** Neues Logo (schwarzer Hintergrund), Favicon, PWA-Icons.
- **Profil:** Manueller Avatar-Upload (Galerie/Explorer), Passwort-Sicherheitscheck (Alt-Passwort erforderlich).

## Technical Details
- **Export:** `lib/export-utils.js` nutzt die `docx` Bibliothek für echte Word-Files. 
- **PDF-Fix:** Radikale CSS-Isolation im Druckmodus (`margin: 0` in @page) eliminiert Domain/Datum-Header; CSS-Padding simuliert Seitenränder.
- **Stability:** Typsicheres Rendering in `TranscriptionDetail` und `OCR` verhindert Abstürze bei unvollständigem KI-JSON.
- **Audio Fix:** Erzwingung von `audio/webm` und korrektem Mime-Mapping für Mistral API.
- **Database:** Migrationspfad via `lib/db-init.js` (model, document_html, avatar_url hinzugefügt).

## Feature Requests (14) — ALLE UMGESETZT
- ~~F1: Tagline & Rebranding GhostTyper~~
- ~~F2: Ausgabesprache DE/EN für Analyse~~
- ~~F3: Übersetzungs-Modul (Workflow-integriert + OCR Import)~~
- ~~F4: OCR / Document AI (Mistral OCR + Historie)~~
- ~~F5: Trennung Transkription/Weiterverarbeitung~~
- ~~F6: In-App Audio-Aufnahme~~
- ~~F7: Admin-System (User-Verwaltung)~~
- ~~F8: Admin kann API-Keys für Nutzer hinterlegen~~
- ~~F9: Token/Kostenzähler in € mit Limit~~
- ~~F10: Modellauswahl (pro Job wählbar)~~
- ~~F11: Individuelle Verarbeitungsvorlagen (Bearbeitbare Standard-Templates)~~
- ~~F12: Logo-Integration & Branding (Mistral Orange)~~
- ~~F13: Vertikale Sidebar-Navigation (Reorganisiert)~~
- ~~F14: Dokumenten-Editor & PDF/DOCX Export~~

## Deployment Info
- **Environment:** Docker Compose (dev/prod).
- **Reverse Proxy:** Traefik mit Let's Encrypt.
- **Secret:** `NEXTAUTH_SECRET` aus Docker-Config verwenden für DB-Init.