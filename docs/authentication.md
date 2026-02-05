# Authentifizierung Dokumentation

## Übersicht

Dieses Dokument beschreibt die Authentifizierung für die Transkription WebApp. Die Anwendung verwendet NextAuth.js für die Authentifizierung.

## Architektur

### NextAuth.js

NextAuth.js ist eine Authentifizierungsbibliothek für Next.js-Anwendungen. Sie unterstützt verschiedene Authentifizierungsanbieter wie Google, GitHub, Facebook, Twitter, Email/Passwort und mehr.

### Authentifizierungsfluss

1. **Anmeldung**: Der Benutzer meldet sich über einen Authentifizierungsanbieter an.
2. **Sitzung**: Nach der Anmeldung wird eine Sitzung erstellt.
3. **Zugriff**: Der Benutzer kann auf geschützte Seiten zugreifen.
4. **Abmeldung**: Der Benutzer meldet sich ab.

## Konfiguration

### NextAuth.js-Konfiguration

Die NextAuth.js-Konfiguration ist in der Datei `pages/api/auth/[...nextauth].js` definiert:

```javascript
import NextAuth from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import GitHubProvider from 'next-auth/providers/github'
import EmailProvider from 'next-auth/providers/email'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export default NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    }),
    EmailProvider({
      server: {
        host: process.env.EMAIL_SERVER_HOST,
        port: process.env.EMAIL_SERVER_PORT,
        auth: {
          user: process.env.EMAIL_SERVER_USER,
          pass: process.env.EMAIL_SERVER_PASSWORD,
        },
      },
      from: process.env.EMAIL_FROM,
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async session({ session, token, user }) {
      session.user.id = user.id
      return session
    },
  },
})
```

### Umgebung

Die Umgebung wird über die `.env`-Datei konfiguriert. Eine Beispiel-Datei ist im Repository enthalten.

- **GOOGLE_CLIENT_ID**: Google OAuth Client ID
- **GOOGLE_CLIENT_SECRET**: Google OAuth Client Secret
- **GITHUB_CLIENT_ID**: GitHub OAuth Client ID
- **GITHUB_CLIENT_SECRET**: GitHub OAuth Client Secret
- **EMAIL_SERVER_HOST**: Email Server Host
- **EMAIL_SERVER_PORT**: Email Server Port
- **EMAIL_SERVER_USER**: Email Server Benutzername
- **EMAIL_SERVER_PASSWORD**: Email Server Passwort
- **EMAIL_FROM**: Email Absender
- **NEXTAUTH_SECRET**: Geheimnis für NextAuth.js
- **NEXTAUTH_URL**: URL der Anwendung

## Setup

### Voraussetzungen

- Next.js
- NextAuth.js
- Datenbank (PostgreSQL)

### Installation

1. **Abhängigkeiten installieren**:

```bash
npm install next-auth @next-auth/prisma-adapter @prisma/client
```

2. **NextAuth.js-Konfiguration erstellen**:

```bash
mkdir -p pages/api/auth
```

3. **NextAuth.js-Konfiguration erstellen**:

```bash
touch pages/api/auth/[...nextauth].js
```

4. **NextAuth.js-Konfiguration bearbeiten**:

```bash
nano pages/api/auth/[...nextauth].js
```

5. **Umgebung konfigurieren**:

```bash
nano .env
```

## Entwicklung

### 1. Authentifizierung testen

1. **Anwendung starten**:

```bash
npm run dev
```

2. **Anmeldung testen**:

Die Anwendung ist unter `http://localhost:3000` verfügbar. Die Anmeldung ist unter `http://localhost:3000/api/auth/signin` verfügbar.

### 2. Sitzung testen

1. **Sitzung abrufen**:

```javascript
import { useSession } from 'next-auth/react'

export default function Component() {
  const { data: session } = useSession()

  if (session) {
    return (
      <div>
        <p>Willkommen, {session.user.email}</p>
      </div>
    )
  }

  return (
    <div>
      <p>Nicht angemeldet</p>
    </div>
  )
}
```

### 3. Geschützte Seiten

1. **Geschützte Seite erstellen**:

```javascript
import { getSession } from 'next-auth/react'

export async function getServerSideProps(context) {
  const session = await getSession(context)

  if (!session) {
    return {
      redirect: {
        destination: '/api/auth/signin',
        permanent: false,
      },
    }
  }

  return {
    props: { session },
  }
}

export default function ProtectedPage({ session }) {
  return (
    <div>
      <h1>Geschützte Seite</h1>
      <p>Willkommen, {session.user.email}</p>
    </div>
  )
}
```

## Datenbank

Die Anwendung verwendet eine PostgreSQL-Datenbank. Die Datenbank-Konfiguration ist in der `docker-compose.dev.yml` definiert.

- **Benutzername**: postgres
- **Passwort**: postgres
- **Datenbank**: transkription
- **Port**: 5432

## Probleme

### 1. Datenbank-Verbindung

Falls die Datenbank-Verbindung fehlschlägt, muss die Datenbank-Konfiguration überprüft werden:

```bash
nano config/docker-compose.dev.yml
```

### 2. Authentifizierungsanbieter

Falls die Authentifizierungsanbieter nicht funktionieren, müssen die OAuth-Credentials überprüft werden:

```bash
nano .env
```

### 3. Sitzung

Falls die Sitzung nicht funktioniert, muss das NextAuth.js-Geheimnis überprüft werden:

```bash
nano .env
```

## Tests

### Lokale Tests

1. **Anwendung starten**:

```bash
npm run dev
```

2. **Anmeldung testen**:

Die Anwendung ist unter `http://localhost:3000` verfügbar. Die Anmeldung ist unter `http://localhost:3000/api/auth/signin` verfügbar.

### VPS-Tests

1. **Anwendung starten**:

```bash
docker compose -f config/docker-compose.dev.yml up -d
```

2. **Anmeldung testen**:

Die Anwendung ist unter `https://transkription.helgeroos.de` verfügbar. Die Anmeldung ist unter `https://transkription.helgeroos.de/api/auth/signin` verfügbar.

## Dokumentation

- [Umgebungsanalyse](umgebungsanalyse.md)
- [API-Spezifikation](api-specification.md)
- [Projektplan](PROJECT_PLAN.md)
- [Docker-Setup](docker-setup.md)

## Nächste Schritte

1. **CI/CD-Pipeline einrichten**: GitHub Actions für Build, Test und Deployment konfigurieren.
2. **Audio-Upload-Endpoint implementieren**: Backend-Endpoint für den Audio-Upload erstellen.
3. **AI-Integration**: Mistral-APIs für Transkription und Analyse integrieren.