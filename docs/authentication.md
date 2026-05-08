# Authentifizierung

Stand: 2026-05-07

Dieses Dokument beschreibt die aktuelle Authentifizierungs- und Autorisierungslogik in GhostTyper.

## 1. Auth-Architektur

- Auth-Framework: NextAuth mit zwei Providern parallel:
  - **OIDC** (default) — gegen einen externen IdP (Authentik, Keycloak,
    Authelia, Auth0, …) konfiguriert via `OIDC_ISSUER`,
    `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`. Erstes Login eines neuen
    OIDC-Users legt automatisch eine `users`-Row mit zufälligem
    bcrypt-Hash an (kein Passwort-Login möglich).
  - **Credentials** (Opt-in via `AUTH_CREDENTIALS_ENABLED=true`) —
    Email + bcrypt-Passwort gegen `users.password_hash`. Nutzbar wenn
    kein IdP vorhanden, bewusst standardmäßig aus.
- Session-Modell: JWT-basierte Sessions; Cookie enthält
  `currentOrganizationId` + `organizations[]`-Memberships.
- Benutzerquellen: Tabelle `users` in PostgreSQL.
- Globales User-Rollenmodell (Spalte `users.role`): `user`, `admin`
  (admin nur für globale System-Admin-Aktionen wie Workspace-
  Anlage über `/admin/workspaces`).
- **Workspace-Rollen-Matrix** für alles Org-Scoped: siehe
  `lib/permissions.js` mit den Rollen `viewer`, `auditor`, `member`,
  `admin`, `owner`. Permissions-Check über `withOrgScope({ permission })`-
  Wrapper an jedem Org-bezogenen API-Endpoint.

## 2. Login-Flow

1. Nutzer sendet E-Mail + Passwort an NextAuth Credentials.
2. Passwort wird gegen `password_hash` (bcrypt) geprüft.
3. Bei Erfolg wird JWT-Session erstellt.
4. API-Routen prüfen Session via `getServerSession`.

Relevante Route:
- `pages/api/auth/[...nextauth].js`

## 3. Autorisierung

- Standardrouten: nur authentifizierte Nutzer
- Adminrouten: zusätzlicher Rollencheck (`admin`)
- Datenzugriffe sind nutzergebunden (z. B. `WHERE user_id = $sessionUserId`)

## 4. Sicherheitsmaßnahmen

- Login-Rate-Limit aktiv
- reduzierte sensible Auth-Logs
- Passwort-Policy mit Komplexitätsanforderungen
- getrennte Secrets für unterschiedliche Sicherheitsdomänen:
  - `NEXTAUTH_SECRET` für Auth
  - `DB_INIT_SECRET` für DB-Init-Route

## 5. Relevante ENV-Variablen

- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `DATABASE_URL`

Optional/ergänzend:
- `DB_INIT_SECRET`
- `ENABLE_DB_INIT_API`

## 6. Passwort- und Benutzerpflege

- Admin-Benutzerverwaltung über Admin-UI/API
- initialer Admin per CLI-Skript:
```bash
npm run seed-admin
```

## 7. Fehlerbilder

### 7.1 Login schlägt trotz korrekter Daten fehl
- Prüfen, ob `NEXTAUTH_SECRET` gesetzt ist.
- Prüfen, ob Nutzer in `users` existiert.
- Prüfen, ob Hash-Format gültig ist (bcrypt).

### 7.2 Session wird nicht gehalten
- `NEXTAUTH_URL` prüfen (Domain/Port korrekt)
- Cookie-/Proxy-Setup prüfen (insb. hinter Traefik)

### 7.3 Adminzugriff fehlt
- Rollenwert in `users.role` prüfen
- sicherstellen, dass der Session-User der erwartete Account ist

## 8. Referenzen

- Troubleshooting: `troubleshooting-auth.md`
- Security-Hardening: `code-review-hardening-2026-02-11.md`
- Betrieb: `../README.md`
