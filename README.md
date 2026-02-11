# GhostTyper

**Your thought, decoded and distilled.**

GhostTyper ist eine leistungsstarke Webanwendung für Audio-Transkription, KI-gestützte Analyse, Dokumenten-OCR und Übersetzung. Sie nutzt modernste KI-Modelle von Mistral AI (Voxtral, Mistral Large, Mistral OCR) in einer datenschutzfreundlichen, selbstgehosteten Umgebung.

![GhostTyper Screenshot](public/logo-text.png)

## Features

### Audio & Transkription
- **Transkription**: Hochpräzise Audio-zu-Text Umwandlung mit `voxtral-mini`.
- **Sprechererkennung (Diarization)**: Erkennt verschiedene Sprecher und ermöglicht einfache Namenszuweisung.
- **In-App Aufnahme**: Direkt im Browser aufnehmen (Desktop & Mobile).
- **Kontext-Bias**: Fachbegriffe und Namen durch benutzerdefinierte Wörterlisten besser erkennen.

### KI-Analyse & Verarbeitung
- **Strukturierte Analyse**: Automatische Zusammenfassungen, To-Do-Listen oder Aufmaß-Daten mittels `mistral-large`.
- **Individuelle Vorlagen**: Erstellen Sie eigene Prompts für spezifische Anwendungsfälle (z.B. Arztbriefe, Baustellenberichte).
- **Modellauswahl**: Wählen Sie zwischen Mistral Large (Qualität), Medium oder Small (Geschwindigkeit/Kosten).

### Dokumente & Übersetzung
- **OCR / Document AI**: Textextraktion aus PDFs und Bildern via `mistral-ocr`. Integrierte Kamera-Funktion für mobile Dokumentenerfassung.
- **Übersetzung**: Hochwertige Übersetzungen mit Kontexterhalt.

### Benutzer & Admin
- **Authentifizierung**: Sicheres Login-System (NextAuth.js).
- **Kostenkontrolle**: Detailliertes Tracking der API-Kosten pro User mit monatlichen Limits.
- **Admin-Dashboard**: Benutzerverwaltung und globale Kostenübersicht.
- **Dark Mode UI**: Modernes, augenschonendes Design mit vertikaler Navigation.

## Technologiestack

- **Frontend**: Next.js 13 (Pages Router), React 18, Tailwind CSS
- **Backend**: Next.js API Routes
- **Datenbank**: PostgreSQL 16
- **KI-Backend**: Mistral AI API (Voxtral, Large, OCR)
- **Deployment**: Docker (Multi-Stage), Docker Compose, Traefik

## Installation & Setup

### Voraussetzungen
- Docker & Docker Compose
- Mistral API Key (console.mistral.ai)

### Lokale Entwicklung

1. Repository klonen:
   ```bash
   git clone https://github.com/IhrUsername/transkription_webapp.git
   cd transkription_webapp
   ```

2. Umgebungsvariablen setzen:
   Erstellen Sie eine `.env` Datei basierend auf `.env.example`.

3. Starten mit Docker Compose:
   ```bash
   docker compose -f config/docker-compose.dev.yml up --build
   ```

4. Datenbank initialisieren:
   ```bash
   # Schema erstellen
   curl -X POST http://localhost:3000/api/db-init -H "x-init-secret: IHR_NEXTAUTH_SECRET"
   
   # Admin-User erstellen
   curl -X POST http://localhost:3000/api/admin/seed -H "x-init-secret: IHR_NEXTAUTH_SECRET"
   ```

### Produktion (VPS)

Verwenden Sie `config/docker-compose.prod.yml`. Stellen Sie sicher, dass Traefik als Reverse Proxy konfiguriert ist.

## Lizenz

Private Nutzung.
