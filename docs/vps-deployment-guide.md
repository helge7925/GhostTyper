# GhostTyper: VPS Deployment Guide (Isoliert & Autark)

Dieses Dokument beschreibt die Vorbereitung und Durchführung des Deployments von GhostTyper auf einem VPS (z.B. Hetzner, DigitalOcean) unter Verwendung von Docker und Traefik.

## Architektur-Überblick
Die Anwendung ist so konzipiert, dass sie vollständig **autark** läuft. Sie bringt ihre eigene Datenbank mit und ist über ein isoliertes Docker-Netzwerk geschützt. Der einzige Kontaktpunkt nach außen ist der Reverse-Proxy (Traefik).

- **Web-Container**: Next.js App (Standalone Mode).
- **Datenbank**: PostgreSQL 16 (Alpine-basiert für minimale Größe).
- **Netzwerke**: 
    - `internal`: Privates Netzwerk für App <-> DB Kommunikation.
    - `web`: Externes Netzwerk für die Anbindung an Traefik.

## 1. Voraussetzungen
- Docker und Docker Compose auf dem VPS installiert.
- Ein laufender Traefik Reverse-Proxy im Docker-Netzwerk `web`.
- Eine Domain/Subdomain, die auf die IP des VPS zeigt.

## 2. Vorbereitung der Umgebung (.env)
Erstellen Sie im Hauptverzeichnis des Projekts auf dem VPS eine `.env` Datei. Diese Datei steuert die gesamte Konfiguration:

```env
# Domain & Netzwerk
DOMAIN=transkription.ihre-domain.de

# Datenbank-Konfiguration (isoliert)
DB_USER=ghosttyper_user
DB_PASSWORD=waehle-ein-sicheres-passwort
DB_NAME=ghosttyper_db

# Sicherheit (NextAuth)
# Generieren mit: openssl rand -base64 32
NEXTAUTH_SECRET=ihr-sehr-langer-geheimstring
NEXTAUTH_URL=https://transkription.ihre-domain.de

# KI-Backend
MISTRAL_API_KEY=ihr-api-key-von-mistral-ai
```

## 3. Deployment-Schritte

### A. Container bauen und starten
Navigieren Sie in das Projektverzeichnis und führen Sie aus:
```bash
docker compose -f config/docker-compose.prod.yml up --build -d
```

### B. Datenbank initialisieren
Nach dem ersten Start müssen die Tabellen angelegt werden. Dies geschieht über den internen Initialisierungs-Endpunkt:
```bash
curl -X POST https://transkription.ihre-domain.de/api/db-init 
  -H "x-init-secret: IHR_NEXTAUTH_SECRET"
```

### C. Admin-Konto erstellen (CLI)
Um sich sicher als Administrator anzulegen, nutzen Sie das mitgelieferte CLI-Tool innerhalb des laufenden Containers:
```bash
docker exec -it transkription-webapp npm run seed-admin
```
Folgen Sie den Anweisungen im Terminal, um E-Mail, Name und ein sicheres Passwort festzulegen.

## 4. Wartung & Sicherheit
- **Backups**: Sichern Sie regelmäßig das Docker-Volume `transkription-db-data`.
- **Updates**: Zum Aktualisieren der App führen Sie einfach `git pull` und den Build-Befehl aus Schritt 3A erneut aus.
- **Isolation**: Die Datenbank ist von außen nicht erreichbar und nur mit dem Web-Container verknüpft.

---
*Dokumentation erstellt am 11. Februar 2026*
