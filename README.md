# Transkriptions-WebApp

Eine Webanwendung zur Transkription von Audiodateien mit Mistral Voxtral als Transkriptionsmodell. Die Anwendung bietet Benutzerauthentifizierung, Template-Management und mobile Integration für den direkten Zugriff auf Audiodateien.

## Funktionen

- **Benutzerauthentifizierung**: Registrierung, Anmeldung und API-Key-Verwaltung
- **Dateiupload**: Direkter Zugriff auf Handyspeicher und Integration mit Share Target API
- **Template-Management**: Erstellen, Bearbeiten und Löschen von Templates für die Formatierung transkribierter Texte
- **Transkription**: Integration der Mistral Voxtral API zur Verarbeitung von Audiodateien
- **Mobile Optimierung**: Progressive Web App (PWA) für bessere mobile Nutzung

## Technologiestack

- **Frontend**: Next.js, Tailwind CSS
- **Backend**: Node.js mit Express oder Next.js API Routes
- **Datenbank**: PostgreSQL
- **Authentifizierung**: NextAuth.js mit JWT
- **Infrastruktur**: Docker, Nginx als Reverse Proxy

## Deployment

Die Anwendung ist für den Betrieb auf einem Virtual Private Server (VPS) in einem Docker-Container konzipiert und soll über die Subdomain `transkription.helgeroos.de` erreichbar sein.
