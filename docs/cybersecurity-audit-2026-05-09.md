# Cybersecurity Audit (2026-05-09) — Enterprise Tandem Review

## Scope

Vollständiger Enterprise-Sicherheits- und Datenschutz-Audit der gesamten Codebase
(`pages/api/**`, `lib/**`, `components/**`, `middleware.js`, `next.config.js`,
`Dockerfile`, `config/docker-compose*.yml`, `scripts/**`).

Schwerpunkte: AuthN/AuthZ, Multi-Tenancy, Krypto/Secrets, Injection (SQL/XSS/Command/SSRF),
Path-Traversal, CSRF, CSP, Upload, Rate-Limit, DSGVO/Datenfluss, Supply-Chain,
Container-Hardening, Logging-Hygiene, Webhooks.

## Methodik — Tandem-Audit

Zwei voneinander unabhängige Auditoren ohne Abstimmung untereinander, beide mit
Zugriff auf den vollständigen Codebase-Snapshot:

- **Auditor 1:** Claude Opus 4.7 (1M-Kontext) — vollständige statische Analyse,
  `npm audit --json` mit aktivem Netzwerk, alle 60+ API-Routen + zentrale
  `lib/`-Module gelesen.
- **Auditor 2:** Codex (gpt-5.3-codex, high reasoning effort) — eigenständige
  statische Analyse über `codex-companion`, ohne Netzwerkzugang in der
  Sandbox (deshalb `npm audit` nur durch Auditor 1 verifiziert).

Konsolidierung: Convergente Befunde validieren sich gegenseitig; divergente
Befunde wurden einzeln nachgeprüft und in den Endbericht übernommen, wenn der
zugrundeliegende Code das Risiko bestätigt. Severity-Diffs zwischen den Auditoren
werden im Anhang dokumentiert.

OWASP-Mapping pro Befund: ASVS L2/L3 + Top-10-2021. CWE-Mapping zur Compliance-
und Risiko-Klassifikation.

---

## Executive Summary

Die Codebase zeigt eine **bemerkenswert solide Sicherheits-Grundarchitektur**:
zentrale RBAC-Schicht (`withOrgScope`), durchgängig parametrisierte SQL,
AES-256-GCM für API-Keys at rest, HMAC mit Replay-Window und Idempotency-Tabelle
für Vexa-Webhooks, magic-byte-basierte Upload-Validierung, harte CSP mit Nonce,
zentrale Permissions-Matrix (`lib/permissions.js`), Audit-Log mit Org-Scope und
Retention-Skript. Das Niveau liegt **deutlich über dem typischen Mid-Market-SaaS**.

Es bestehen jedoch **enterprise-blockierende Befunde**:

1. **OIDC-Account-Takeover** bei nicht verifizierter E-Mail
2. **Cross-Org-Bridge-Key-Selektion** durchbricht die Workspace-Grenze global
3. **Next.js 13.4.0** hat 12 dokumentierte CVEs (Authorization-Bypass, SSRF, DoS)
4. **Vexa-Webhook-Reihenfolge** ermöglicht Org-Existenz-Enumeration vor HMAC-Prüfung
5. **Pre-Auth Memory-DoS** durch unbegrenzte Webhook-Body-Größe
6. **Virus-Scan-Wrapper-Bug** durch falsches `JSON.stringify`-Quoting
7. **Chromium läuft im Default ohne Sandbox** beim PDF-Export
8. **Drittlanddatenübermittlung** an Fireworks (US) bei Vexa-Aktivierung —
   biometrische Daten Art. 9 DSGVO
9. **Markdown-XSS** über `marked → dangerouslySetInnerHTML` ohne DOMPurify
10. **Public-Share-Endpoints** ermöglichen Kosten-DoS auf Workspace-Owner

Auth-Reifegrad ist unter Enterprise-Niveau: **kein MFA**, **kein Account-Lockout**,
**keine OIDC-Domain-Allowlist**, **JWT-Role wird bei Demotion nicht gerefresht**
(Privilege-Revocation-Lag).

Das System ist **sicher betreibbar nach Behebung der Top-10-Befunde**. Vorher
sollte es **nicht für Produktivdaten** verwendet werden, die DSGVO Art. 9 oder
ähnliche Schutzklassen betreffen.

---

## Befunde nach Severity

### CRITICAL

#### C1 — OIDC E-Mail-Linking ermöglicht Account-Takeover

- **CWE:** 287 / 290 — **OWASP:** A07:2021
- **Konvergent:** beide Auditoren, Critical
- **Datei:** `pages/api/auth/[...nextauth].js:124-145`

Beim ersten OIDC-Login wird `profile.email` ohne `email_verified`-Prüfung
verwendet, mit `lower(email)` ein bestehender DB-User gesucht und dessen `id`
und `role` ins Token übernommen. Es existiert keine Provider-Account-Binding
(`provider`, `providerAccountId`)-Tabelle.

**Angriff:** Angreifer registriert bei einem schwach konfigurierten OIDC-IdP
(oder kompromittiert ihn) eine E-Mail, die einem lokalen `admin`-Account
entspricht. Beim ersten Login erhält er ein JWT mit DB-User-ID und der
Plattform-Rolle des Opfers.

**Fix:**
```js
if (account?.provider === 'oidc') {
  if (profile.email_verified !== true) return token;
  // Strikte Trennung: existierende Identitäten nur mergen, wenn
  // explizit konfiguriert und Admin-bestätigt.
  const linked = await query(
    'SELECT user_id FROM oidc_account_bindings WHERE provider_account_id = $1',
    [profile.sub]
  );
  // …
}
```

#### C2 — Cross-Org-Bridge-Key-Selektion (Tenant-Boundary-Break)

- **CWE:** 200 / 284 — **OWASP:** A01:2021
- **Konvergent:** Codex Critical, Mein Audit hatte Medium → angeglichen auf Critical
- **Datei:** `lib/integrations.js:145-170`, `pages/api/internal/whisper-config.js:42`

`resolveBridgeTranscriptionConfig` wählt **global** den "zuletzt aktualisierten"
enabled Mistral-Integration-Key über alle Workspaces hinweg. Die `fireworks-bridge`
ruft diesen über `/api/internal/whisper-config` ab und nutzt ihn für Live-
Transkriptionen aller Vexa-Bots.

**Angriff:** Workspace A aktualisiert seinen Mistral-Key zuletzt → die
Live-Transkriptionen aller anderen Workspaces verbrauchen jetzt das Quota
des Workspace A und werden gegen dessen Provider-Account abgerechnet. Audio-
Inhalte aus Workspace B fließen über den API-Key von Workspace A — Cross-Org-
Datenfluss bzgl. Provider-Telemetrie und Abrechnung.

**Fix:** Bridge muss org-aware werden. Optionen:

1. Operator-Bridge-Key als separates ENV (`BRIDGE_TRANSCRIPTION_API_KEY`),
   nicht aus Workspace-Settings.
2. Bridge sendet `X-Romaco-Org`-Header pro Anfrage; `whisper-config` löst
   strikt für diese Org auf.
3. Pro Org separate Bridge-Container.

---

### HIGH

#### H1 — Next.js 13.4.0 mit 12 dokumentierten CVEs

- **CWE:** 285 / 918 / 400 — **OWASP:** A06:2021
- **Konvergent:** Mein Audit High (npm audit verifiziert), Codex "needs verification"
- **Datei:** `package.json:55`

`npm audit --json` aus diesem Audit bestätigt:
- Authorization Bypass (GHSA-7gfc-8cq8-jh5f, CVSS 7.5) — fixed in 14.2.15
- SSRF in Server Actions (GHSA-fr5h-rqp8-mj6g, CVSS 7.5) — fixed in 14.1.1
- Middleware-Redirect-SSRF (GHSA-4342-x723-ch2f, CVSS 6.5) — fixed in 14.2.32
- DoS via Server-Components-Deserialization (GHSA-h25m-26qc-wcjf, CVSS 7.5)
- Cache-Key-Confusion bei Image API (GHSA-g5qg-72qw-gw5v)
- 7 weitere DoS / Information-Exposure / Race-Condition CVEs

**Fix:** Upgrade auf `next@14.2.35` (LTS-konform mit Pages Router) oder `next@15.5.10`.

#### H2 — Vexa-Webhook: HMAC-Prüfung nach DB-Lookup → Org-Existenz-Leak

- **CWE:** 203 / 208 — **OWASP:** A01:2021
- **Konvergent:** beide High
- **Datei:** `pages/api/webhooks/vexa.js:294-322`

Reihenfolge: `pickMeetingFields → loadTranscriptionByMeeting (DB) →
resolveVexaConfig → integration.enabled → verifyVexaSignature`. Antworten
unterscheiden sich (202 IGNORED vs 401 INVALID_SIGNATURE).

**Angriff:** Unauthentifiziert. Probe-POSTs mit verschiedenen
`meeting.platform`/`native_meeting_id`-Kombinationen erlauben Enumeration
existierender Meetings und aktiver Vexa-Workspaces.

**Fix:** Frühe HMAC-Prüfung gegen einen org-übergreifenden Receiver-Secret +
Org-Identifier im Header (`X-Romaco-Org`). Bei ungültiger Signatur konstante
202-Antwort, asynchrones Logging.

#### H3 — Webhook unbegrenzte Body-Größe vor Authentifizierung

- **CWE:** 400 / 770 — **OWASP:** A05:2021
- **Konvergent:** beide High
- **Datei:** `pages/api/webhooks/vexa.js:28-35`

`readRawBody` puffert beliebig große Bodies in Memory ohne Limit, bevor
HMAC geprüft wird (`bodyParser: false`).

**Fix:**
```js
async function readRawBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(Object.assign(new Error('BODY_TOO_LARGE'), { code: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
```

#### H4 — Rate-Limit-Bypass via X-Forwarded-For + Direkt-Port-Mapping

- **CWE:** 345 / 770 — **OWASP:** A04:2021
- **Konvergent:** beide High
- **Datei:** `lib/rate-limit.js:23-34`, `config/docker-compose.prod.yml:15,54`

`getClientIp` nimmt das **erste** Element von `x-forwarded-for` ungeprüft, sobald
`RATE_LIMIT_TRUST_PROXY=true` (Compose-Default). Compose exponiert Port 3000
zusätzlich zu Traefik direkt am Host (`"${WEBAPP_HOST_PORT:-3000}:3000"`) — ein
direkter Client kann `X-Forwarded-For: 1.2.3.4` setzen und sein eigentlicher
Bucket bleibt frei. `lib/network-guard.js:extractClientIp` macht es korrekt
(Trust nur bei Private-Network-Source), wird aber von `rate-limit.js` nicht
verwendet.

**Fix:**
- `rate-limit.js` auf `extractClientIp` aus `network-guard.js` umstellen.
- Direkt-Port-Mapping in `compose.prod.yml:15` entfernen (nur Traefik-Routing).

#### H5 — `lib/virus-scan.js` `JSON.stringify`-Quoting → Scanner immer falsch aufgerufen

- **CWE:** 88 / 754 — **OWASP:** A05:2021
- **Konvergent:** Mein Audit High, Codex Medium → fix-Aufwand minimal, Auswirkung Funktionsbruch
- **Datei:** `lib/virus-scan.js:18-44`

```js
const quotedPath = JSON.stringify(filePath);   // → "/uploads/abc.mp3" (mit Anführungszeichen)
…
const child = spawn(cmd, args, { shell: false });
```

`shell: false` braucht keine Quotes. Die `"` werden Teil des Dateinamen-Arguments
→ clamscan findet die Datei nicht → Exit ≠ 0. Bei `UPLOAD_VIRUS_SCAN_FAIL_OPEN=true`
**werden alle Uploads als clean markiert** (Bypass). Bei Default `false`
**werden alle legitimen Uploads abgelehnt**.

**Fix:** `quotedPath = filePath`. Test mit echtem clamscan-EICAR-Sample.

#### H6 — Chromium `--no-sandbox` als Production-Default

- **CWE:** 657 — **OWASP:** A05:2021
- **Datei:** `lib/pdf-export.js:152-269`, `config/docker-compose.prod.yml:52`

`PDF_CHROMIUM_NO_SANDBOX=${PDF_CHROMIUM_NO_SANDBOX:-true}` — Default in Production
ist **TRUE**. Zusätzlicher Auto-Fallback in `pdf-export.js:252-269` macht
Sandbox-Failure zu einem stillen Bypass.

**Angriff:** Editor-HTML wird (mit DOMPurify-Filter) als PDF gerendert. Bei einem
DOMPurify-Bypass + Chromium-Renderer-Bug = RCE im Container.

**Fix:**
- Compose-Default auf `false`.
- Auto-`--no-sandbox`-Fallback in `pdf-export.js` entfernen (fail-closed).
- Kapability-Set des Containers prüfen (kein `SYS_ADMIN`).
- Optional: `seccomp`/`apparmor`-Profile.

#### H7 — `marked → dangerouslySetInnerHTML` ohne DOMPurify (Markdown-XSS)

- **CWE:** 79 — **OWASP:** A03:2021
- **Konvergent:** Codex High, Mein Audit Medium → angeglichen auf High
- **Datei:** `lib/export-utils.js:17-20`, `pages/translate.js:506`

`mdToHtml` ruft `marked.parse(md, { breaks: true, gfm: true })` ohne Sanitize-Option
(deprecated in marked 5+). Output wird direkt via `dangerouslySetInnerHTML`
gerendert. `translatedText` kommt von Mistral (untrusted).

**Angriff:** Prompt-Injection im zu übersetzenden Text → Mistral gibt
HTML-Payload zurück → XSS im Browser des Users.

**Fix:** DOMPurify ist bereits importiert in `lib/export-utils.js`:
```js
import DOMPurify from 'dompurify';
export function mdToHtml(md) {
  if (!md) return '';
  return DOMPurify.sanitize(marked.parse(md, { breaks: true, gfm: true }));
}
```
Hinweis: `DOMPurify` ist client-only — für Server-Side-Render stattdessen
`isomorphic-dompurify` oder `sanitize-html` einsetzen.

#### H8 — Public-Share-Endpoints → Cost-Exhaustion-DoS auf Workspace-Owner

- **CWE:** 400 — **OWASP:** A04:2021
- **Konvergent:** Codex High, Mein Audit Medium → angeglichen auf High
- **Datei:** `pages/api/share/[token]/audio.js:44-101`, `…/stream.js:46`

Anonyme Viewer triggern long-lived TTS-Streams; Mistral-Kosten gehen auf den
Row-Owner. Aktueller Limiter ist `tok:${token.slice(0,16)}` mit 10/60s — also
10 gleichzeitige Streams pro Token, jeder bis zu 4h.

**Angriff:** Attacker öffnet wiederholt Streams gegen denselben Share-Link →
kontinuierliche TTS-Generation auf Owner-Account → Kosten-DoS.

**Fix:**
- Concurrency-Cap pro Token (max. 3 gleichzeitige Streams).
- Globaler Org-Budget-Guard für `live_tts_share` (z. B. max. 60 Min/Tag/Org).
- IP-basierte Rate-Limit zusätzlich (über `extractClientIp`).
- Rate-Limit auf `/share/[token]/stream` ergänzen.

#### H9 — DSGVO Art. 9: Drittlanddatenübermittlung an Fireworks (US)

- **OWASP:** Privacy / GDPR Art. 9 + Art. 44 ff.
- **Datei:** `.env.example:80-84`, `config/docker-compose.prod.yml:145`

Bei aktiviertem Vexa-Profil sendet die `fireworks-bridge` Audio-Streams an
einen externen Endpoint. Default-Vorschlag im README/`.env.example` referenziert
Fireworks AI (US). Audio = biometrische Daten Art. 9 DSGVO. US-Transfer nach
Schrems II nur mit SCC + TIA, problematisch für Art. 9-Daten ohne expliziten
Einwilligungs-Workflow.

**Fix:**
- Default auf **Cortecs (EU)** oder Mistral Voxtral (FR).
- README-Kapitel "DSGVO-konformes Setup" mit AVV-Templates.
- Datenfluss-Logging für Verzeichnis von Verarbeitungstätigkeiten (Art. 30).

#### H10 — Last-Plattform-Admin-Lockout-Risiko

- **CWE:** 693 — **OWASP:** A04:2021
- **Datei:** `pages/api/admin/users/[id].js:73-76, 200-202`

Selbst-Schutz blockiert nur eigene Role-Down/Delete. Admin A kann den letzten
anderen Plattform-Admin downgraden oder löschen. Wenn A danach selbst
demotiert wird, hat das System keinen Plattform-Admin mehr.

**Fix:**
```js
const otherAdmins = await client.query(
  "SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND id != $1",
  [userId]
);
if (otherAdmins.rows[0].n === 0 && (newRole !== 'admin' || method === 'DELETE')) {
  return res.status(400).json({ message: 'Mindestens ein Plattform-Admin muss verbleiben.' });
}
```

---

### MEDIUM

#### M1 — `lib/secrets.js` ohne HKDF / AAD / Key-Rotation

- **CWE:** 320 / 326 / 345 — **OWASP:** A02:2021
- **Datei:** `lib/secrets.js:10-27`

Key-Derivation per nacktem `sha256(SETTINGS_ENCRYPTION_KEY)`, keine HKDF mit
Domain-Separation, **keine AAD**, keine Key-Rotation-Implementierung.

**Risiken:**
- Ciphertexte sind kontextfrei → bei DB-Schreibzugriff können Werte zwischen
  Spalten/Zeilen getauscht werden (z. B. Mistral-Key in Vexa-Token-Spalte).
- Kein Domain-Separation pro Verwendungszweck.
- `v1`-Prefix vorbereitet, aber kein Migrationspfad.

**Fix:** HKDF mit Context-Info pro Encryption-Aufruf + AAD-Bindung an
`(field, organization_id)`. Versionierte Key-IDs.

#### M2 — Admin-Privilege-Revocation-Lag (JWT-Role nicht gerefresht)

- **CWE:** 285 / 613 — **OWASP:** A01:2021
- **Quelle:** Codex unique
- **Datei:** `lib/admin.js:16`, `pages/api/auth/[...nextauth].js:146-150`

`requireAdmin` liest `session.user.role` aus dem JWT. Im `jwt`-Callback wird
`token.role` nur beim Initial-Sign-in gesetzt. Demoteter Admin behält bis
Token-Refresh seine Rechte (NextAuth JWT-Sessions haben kein Server-seitiges
Invalidate).

**Fix:** In `requireAdmin` zusätzlich `SELECT role FROM users WHERE id = $1`
prüfen. Oder Token-Versioning: `users.token_version` inkrementieren bei
Role-Change, JWT-Callback prüft.

#### M3 — Last-Org-Owner-Protection fehlt

- **CWE:** 732 — **OWASP:** A01:2021
- **Quelle:** Codex unique
- **Datei:** `pages/api/organizations/members.js:67`

Org-Owner kann den letzten verbleibenden Org-Owner demotieren/entfernen.
Workspace bleibt ohne Owner zurück.

**Fix:** Vor Role-Change-away-from-`owner` und Member-DELETE prüfen
`count(*) > 1 WHERE role='owner' AND organization_id = $1`.

#### M4 — Login-Rate-Limit ohne Account-Lockout

- **CWE:** 307 — **OWASP:** A07:2021
- **Datei:** `pages/api/auth/[...nextauth].js:24-31`

Nur 10 Versuche/IP/5min. Bei verteiltem Brute-Force (Botnet) wirkungslos.
Kein Account-Lockout für einzelne User.

**Fix:** Pro-Email-Counter mit progressivem Backoff, 30-Min-Lockout nach
25 Fehlversuchen.

#### M5 — Kein MFA für Plattform-Admins / Workspace-Owner

- **OWASP:** A07:2021
- **Datei:** global

**Fix:** TOTP via `speakeasy` oder WebAuthn. Verpflichtend für `admin` + `owner`,
optional für andere Rollen.

#### M6 — Login-User-Enumeration via Timing

- **CWE:** 208 — **OWASP:** A07:2021
- **Datei:** `pages/api/auth/[...nextauth].js:43-50`

Nicht-existenter User → sofortiges `null`. Existenter User → `bcrypt.compare`
(~100 ms). Timing-Side-Channel.

**Fix:** Auch bei "user not found" Dummy-`bcrypt.compare` mit fixem Hash aufrufen.

#### M7 — OIDC-Auto-Provisioning ohne Domain-Allowlist

- **OWASP:** A07:2021
- **Datei:** `pages/api/auth/[...nextauth].js:131-140`

Self-Registration ist via `register.js` deaktiviert, aber jeder OIDC-Login
erstellt einen neuen User mit `role='user'`. Inkonsistent.

**Fix:** ENV `OIDC_ALLOWED_EMAIL_DOMAINS` oder `OIDC_AUTO_PROVISION=false`.

#### M8 — Audit-Log + Observability speichern PII / Stack-Traces

- **CWE:** 532 — **OWASP:** A09:2021
- **Datei:** `lib/observability.js:32-51`, `lib/audit-log.js:11-47`,
  `pages/api/admin/users/index.js:74-77`

`serializeError` schreibt vollständige Stack-Traces; Audit-Metadata enthält
User-E-Mails. DSGVO-Recht-auf-Vergessen erfordert Pseudonymisierung.

**Fix:** Zentrale Redaction-Policy für Logs (kein Stack in Prod, Hash statt
Klartext-Email). Lösch-Hook für audit-Metadata bei User-Löschung.

#### M9 — `share/[token].js` Rate-Limit-Identifier nutzt rohes XFF

- **CWE:** 345
- **Datei:** `pages/api/share/[token].js:25`

Inkonsistent zu `lib/rate-limit.js`-Pattern; spoofbar.

**Fix:** `extractClientIp()` aus `network-guard.js`.

#### M10 — Zentraler Outbound-URL-Allowlist fehlt

- **CWE:** 918 — **OWASP:** A10:2021
- **Quelle:** Codex unique
- **Datei:** `lib/api/vexa.js:13`, `pages/api/auth/[...nextauth].js:70`

OIDC-Discovery, Vexa-Admin-Health, Mistral, Fireworks nutzen alle eigene
`axios`/`fetch`-Pfade ohne gemeinsamen Egress-Validator. `lib/network-guard.js`
hat Private-IP-Filter, wird aber für ausgehende Requests nicht systematisch
verwendet.

**Fix:** Zentrale `safeFetch(url, { allowlist })`-Helper in `lib/network-guard.js`.
Block bei `localhost`, `169.254.0.0/16`, `metadata.google.internal`,
`fd00::/8`, allen Private-Subnets.

#### M11 — CSRF-Middleware Blind-Spot wenn `Origin` UND `sec-fetch-site` fehlen

- **CWE:** 352 — **OWASP:** A01:2021
- **Datei:** `middleware.js:67-83`

State-changing Requests ohne beide Header werden durchgelassen. Non-Browser /
legacy-Clients umgehen den Schutz; `/api/auth/*`-Exemption ist breit gefasst.

**Fix:** Mindestens ein vertrauenswürdiges Anti-CSRF-Signal verlangen.
`/api/auth`-Exemption auf konkrete NextAuth-Endpoints einschränken.

#### M12 — `bcryptjs@2.4` deprecated

- **OWASP:** A02:2021 / A06:2021
- **Datei:** `package.json:43`

`bcryptjs` ist seit 2017 unmaintained. Pure-JS-Implementierung, langsamer als
`bcrypt` (native), keine Argon2-Option.

**Fix:** Wechsel zu `bcrypt` (native bindings) oder `argon2`. Migrations-Pfad
über `password_hash_version`-Spalte.

#### M13 — `Math.random()` für Org-Slug-Suffix

- **CWE:** 338
- **Datei:** `pages/api/admin/organizations.js:84`

Nicht kryptographisch. Bei Collision-Tolerance unkritisch, aber unschön.

**Fix:** `crypto.randomBytes(2).toString('hex')`.

#### M14 — `node:20-alpine` ohne SHA-Digest-Pin

- **OWASP:** A06:2021 / A08:2021
- **Datei:** `Dockerfile:1, 8, 15`

Supply-Chain-Risiko bei Tag-Compromise.

**Fix:** `FROM node:20.18.0-alpine@sha256:<digest>`.

---

### LOW / INFO

| ID | Befund | Datei |
|----|--------|-------|
| L1 | `apk add` ohne Versionspinning für Chromium/ffmpeg | `Dockerfile:26` |
| L2 | `email-invites.js`: `INVITE_FROM_NAME` aus Operator-ENV → Header-Injection-Risiko | `lib/email-invites.js:18-22` |
| L3 | `lib/api/vexa.js:setBotScreenContent` reicht beliebige URLs an Vexa-Bot weiter | `lib/api/vexa.js:93-106` |
| L4 | `pages/api/internal/whisper-config.js` ohne Rate-Limit (Docker-Internal-Network ok) | — |
| L5 | DB-Pool ohne explizite TLS-Konfig (bei externer Postgres relevant) | `lib/db.js:8-13` |
| L6 | CSP `img-src 'self' data: blob: https:` zu permissiv für externe Tracking-Pixel | `middleware.js:48` |
| Info | CSP nur in Production aktiv | `middleware.js:107-109` |
| Info | `withOrgScope` + `lib/permissions.js` sehr saubere RBAC-Implementierung | — |
| Info | Vexa-Webhook `recordEventOnce` via UNIQUE-Constraint = exzellentes Idempotency-Pattern | `pages/api/webhooks/vexa.js:37-44` |
| Info | DB-Init solide geschützt (NODE_ENV + ENABLE_DB_INIT_API + IP-ACL + timing-safe Secret) | `pages/api/db-init.js` |
| Info | Webhook-HMAC + Share-Token-Entropy korrekt | `lib/vexa-webhook-signature.js`, `lib/share-tokens.js` |

---

## Top-10-Prioritäten für Romaco

| Rang | Befund | Sev. | Aufwand | Begründung |
|------|--------|------|---------|------------|
| 1 | C1 OIDC-Account-Linking absichern | Critical | 1 Tag | Account-Takeover-Vektor, blockierend |
| 2 | C2 Bridge-Key-Selektion org-scoped | Critical | 2–3 Tage | Tenant-Boundary-Break, blockierend |
| 3 | H1 Next.js auf ≥14.2.35 upgraden | High | 2–5 Tage | 12 dokumentierte CVEs, blockierend |
| 4 | H2+H3 Webhook-Reihenfolge + Body-Limit | High | ½ Tag | DoS-Vektor + Info-Leak |
| 5 | H5 Virus-Scan-Bug (`JSON.stringify`) | High | 30 Min | Funktionsbruch oder Bypass |
| 6 | H4 Rate-Limit IP-Logik zentralisieren + Direct-Port-Mapping | High | ½ Tag | Bypass-Vektor |
| 7 | H7 Markdown-XSS via DOMPurify | High | 15 Min | Direkter XSS-Vektor |
| 8 | H8 Public-Share Concurrency + Org-Budget-Guard | High | 1 Tag | Cost-DoS |
| 9 | H6 Chromium-Sandbox-Default + Auto-Fallback entfernen | High | ½ Tag | Defense-in-Depth gegen RCE |
| 10 | M1 Krypto-Hardening (HKDF + AAD + Key-Rotation) mit Migration | Medium | 2 Tage | Audit-Fitness, langfristig |

**Nicht in Top-10, aber wichtig:** H9 DSGVO/Fireworks (Tagesarbeit + Doku),
H10 Last-Plattform-Admin (1 h), M2 Admin-Role-Refresh (2 h), M3 Last-Org-Owner
(1 h), M4+M5 MFA + Account-Lockout (3–5 Tage).

---

## Anhang A — Tandem-Konsolidierung: Severity-Diffs

| Befund | Auditor 1 | Auditor 2 (Codex) | Final |
|--------|-----------|-------------------|-------|
| Bridge-Key Cross-Org | Medium | Critical | **Critical** (Codex' Begründung valide) |
| Markdown-XSS | Medium | High | **High** (Codex' Begründung valide) |
| Public-Share Cost-Exhaustion | Medium | High | **High** (Codex' Begründung valide) |
| Virus-Scan-Bug | High | Medium | **High** (Funktionsbruch-Auswirkung) |
| `secrets.js` HKDF/AAD | High | Medium | **Medium** (Compensating Controls vorhanden) |
| Chromium Sandbox | High | Low | **High** (Default-true in Prod blockierend) |
| Next.js CVEs | High (verifiziert) | Needs verification | **High** |
| Fireworks DSGVO | High (.env.example explicit) | Needs verification | **High** |

## Anhang B — Befunde nur von einem Auditor

**Nur von Codex (gpt-5.3-codex):**
- M2 Admin-Privilege-Revocation-Lag (JWT-Role-Cache)
- M3 Last-Org-Owner-Protection
- M10 Zentraler Outbound-Allowlist fehlt

**Nur von Auditor 1 (Claude Opus 4.7):**
- H1 Next.js-CVE-Liste vollständig (`npm audit` erfolgreich)
- H9 DSGVO / Fireworks-Default
- H10 Last-Plattform-Admin
- M4 Account-Lockout
- M5 MFA
- M6 Login-Timing
- M7 OIDC-Domain-Allowlist
- M12 `bcryptjs` deprecated
- M13 `Math.random()` Slug
- M14 SHA-Image-Pin
- L2–L6 Diverse Low-Findings

## Anhang C — Erkannte Stärken

- Zentrale RBAC-Schicht `withOrgScope` + `lib/permissions.js` (fail-closed,
  konsistent verwendet in allen Routen)
- Durchgängig parametrisierte SQL-Queries; dynamische UPDATEs in
  `transcriptions/[id].js` korrekt mit `$N`-Placeholders
- Magic-Byte-Validation für Audio + Office (`lib/file-signature.js`)
- AES-256-GCM mit zufälligem 12-Byte-IV, AuthTag-Verify (Krypto-Primitive korrekt;
  KDF/AAD ist M1-Thema)
- Vexa-Webhook: HMAC-SHA256 + Replay-Window 300 s + Idempotency via UNIQUE-Constraint
- Share-Tokens: 256 Bit Entropie, Org-Scope, Expiry, Revocation
- Audit-Log mit Org-Scope, Severity-Filter, Retention-Skript (idempotent, dry-run)
- Permissions-Matrix `lib/permissions.js` ist fail-closed bei unbekannter Permission
- DB-Init-Endpoint mehrschichtig geschützt (NODE_ENV-Gate, Feature-Flag,
  IP-ACL, timing-safe Secret-Compare)
- Path-Traversal-Schutz konsequent (Upload-Dir-Resolve, retention-Skript,
  Transcription-Delete)
- Non-Root-Container (`uid 1001`)
- `swcMinify`, `poweredByHeader: false`, HSTS preload, COOP/CORP, strikte
  CSP mit Nonce in Production

---

## Anhang D — Hinweise zur Verifikation

Folgende Punkte konnten statisch nicht abschließend bewertet werden und sollten
in einer DAST-/Pen-Test-Phase überprüft werden:

- Schedule-Implementierung des Retention-Skripts (cron/systemd-timer in Prod?)
- Tatsächliche Reverse-Proxy-Header-Konfiguration in Traefik (XFF-Sicherheit)
- Frontend-XSS in nicht via grep erfassten Komponenten
- Transitive Abhängigkeitstiefe (`socket.dev` / `npm-audit-html`)
- DB-Schema in `lib/db-init.js`: Foreign-Key-CASCADE-Verhalten, Index-Strategie
- E2E-Test der Vexa-Webhook-Replay-Resistenz
- Operator-Konfiguration von `MAINTENANCE_IP_ALLOWLIST`

---

**Auditoren:** Claude Opus 4.7 (1M-Kontext) + Codex gpt-5.3-codex (high effort)
**Datum:** 2026-05-09
**Repo-State:** v0.3.0 (`package.json`) / v1.2.0 (`Memory.md`),
Branch: `main` (Workspace-State zum Audit-Zeitpunkt)

---

## Remediation Plan (Follow-up, 2026-05-09)

Dieser Abschnitt konkretisiert die Umsetzung für die drei höchsten Prioritäten
aus dem Audit mit mergebaren Patch-Skizzen, Betreiber-Auswirkungen und Rollout.

### 1) C1 — OIDC `email_verified` + Provider-Account-Binding

**Befund-Referenz (Ist-Zustand):**
- `pages/api/auth/[...nextauth].js:76-83` (OIDC `profile()` ohne `email_verified`)
- `pages/api/auth/[...nextauth].js:124-145` (JWT-Linking nur via `lower(email)`)

#### Zielbild
1. OIDC-Login nur für verifizierte E-Mail-Identitäten zulassen.
2. Persistentes Binding `(provider, provider_account_id) -> user_id` einführen.
3. E-Mail-basierte Verknüpfung nur als explizites Migrations-Flag (`OIDC_LINK_BY_EMAIL=true`).
4. Optionale Domain-Allowlist (`OIDC_ALLOWED_EMAIL_DOMAINS`).

#### Patch-Skizze A — DB-Schema (Binding-Tabelle)

**Datei:** `lib/db-init.js` (im `migrations`-Block, nach vorhandenen User-/Auth-Indices)

```sql
-- OIDC provider-account binding (prevents account takeover via plain email match)
CREATE TABLE IF NOT EXISTS oidc_account_bindings (
  provider VARCHAR(80) NOT NULL,
  provider_account_id VARCHAR(255) NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, provider_account_id)
);
CREATE INDEX IF NOT EXISTS idx_oidc_account_bindings_user_id
  ON oidc_account_bindings(user_id);
```

#### Patch-Skizze B — Auth-Flow (JWT callback + Guards)

**Datei:** `pages/api/auth/[...nextauth].js`

```diff
diff --git a/pages/api/auth/[...nextauth].js b/pages/api/auth/[...nextauth].js
@@
 import { normalizeEmail } from '../../../lib/email';
 
+const OIDC_LINK_BY_EMAIL = String(process.env.OIDC_LINK_BY_EMAIL || 'false').toLowerCase() === 'true';
+const OIDC_ALLOWED_EMAIL_DOMAINS = new Set(
+  String(process.env.OIDC_ALLOWED_EMAIL_DOMAINS || '')
+    .split(',')
+    .map((d) => d.trim().toLowerCase())
+    .filter(Boolean)
+);
+
+function parseEmailVerified(value) {
+  return value === true || value === 'true' || value === 1 || value === '1';
+}
+
+function isAllowedOidcDomain(normalizedEmail) {
+  if (!normalizedEmail) return false;
+  if (OIDC_ALLOWED_EMAIL_DOMAINS.size === 0) return true;
+  const domain = normalizedEmail.split('@')[1]?.toLowerCase() || '';
+  return OIDC_ALLOWED_EMAIL_DOMAINS.has(domain);
+}
+
+async function resolveOidcUser({ provider, providerAccountId, normalizedEmail, displayName }) {
+  // 1) Strict binding lookup first
+  const bound = await query(
+    `SELECT u.id, u.email, u.name, u.role
+       FROM oidc_account_bindings b
+       JOIN users u ON u.id = b.user_id
+      WHERE b.provider = $1 AND b.provider_account_id = $2
+      LIMIT 1`,
+    [provider, providerAccountId],
+  );
+  if (bound.rows[0]) return bound.rows[0];
+
+  // 2) Optional one-time migration path via email match
+  if (!OIDC_LINK_BY_EMAIL) return null;
+  const existing = await query(
+    `SELECT id, email, name, role FROM users WHERE lower(email) = $1 LIMIT 1`,
+    [normalizedEmail],
+  );
+  const dbUser = existing.rows[0] || (await query(
+    `INSERT INTO users (email, name, password_hash, role)
+     VALUES ($1, $2, $3, 'user')
+     RETURNING id, email, name, role`,
+    [normalizedEmail, displayName || normalizedEmail, await bcrypt.hash(randomUUID(), 12)],
+  )).rows[0];
+
+  await query(
+    `INSERT INTO oidc_account_bindings (provider, provider_account_id, user_id)
+     VALUES ($1, $2, $3)
+     ON CONFLICT (provider, provider_account_id) DO NOTHING`,
+    [provider, providerAccountId, dbUser.id],
+  );
+  return dbUser;
+}
@@
       profile(profile) {
         return {
           id: profile.sub,
           name: profile.name || profile.preferred_username || profile.email,
           email: profile.email,
+          emailVerified: parseEmailVerified(profile.email_verified),
           image: profile.picture,
         };
       },
@@
     async jwt({ token, user, account, trigger, session: clientSession }) {
       // Initial sign-in
       if (user) {
         if (account?.provider === 'oidc') {
           const normalizedEmail = normalizeEmail(user.email);
-          if (!normalizedEmail) return token;
-          const existing = await query(
-            'SELECT id, email, name, role FROM users WHERE lower(email) = $1',
-            [normalizedEmail]
-          );
-          const dbUser = existing.rows[0] || (await query(
-            `INSERT INTO users (email, name, password_hash, role)
-             VALUES ($1, $2, $3, 'user')
-             RETURNING id, email, name, role`,
-            [
-              normalizedEmail,
-              user.name || normalizedEmail,
-              await bcrypt.hash(randomUUID(), 12),
-            ]
-          )).rows[0];
+          const providerAccountId = String(account.providerAccountId || '').trim();
+          if (!normalizedEmail || !providerAccountId) {
+            throw new Error('OIDC_IDENTITY_INCOMPLETE');
+          }
+          if (!user.emailVerified) {
+            throw new Error('OIDC_EMAIL_NOT_VERIFIED');
+          }
+          if (!isAllowedOidcDomain(normalizedEmail)) {
+            throw new Error('OIDC_EMAIL_DOMAIN_NOT_ALLOWED');
+          }
+
+          const dbUser = await resolveOidcUser({
+            provider: account.provider,
+            providerAccountId,
+            normalizedEmail,
+            displayName: user.name,
+          });
+          if (!dbUser) {
+            throw new Error('OIDC_ACCOUNT_NOT_LINKED');
+          }
 
           token.id = dbUser.id;
           token.role = dbUser.role;
           token.name = dbUser.name;
           token.email = dbUser.email;
```

#### Betreiber-Impact / Breaking Changes
1. Neue ENV-Variablen:
   - `OIDC_LINK_BY_EMAIL` (Default: `false`, empfohlen)
   - `OIDC_ALLOWED_EMAIL_DOMAINS` (CSV; leer = kein Domain-Filter)
2. DB-Migration für `oidc_account_bindings` ist erforderlich.
3. Nach Aktivierung können OIDC-Logins ohne `email_verified=true` nicht mehr einloggen.

#### Rollout-Sequenz
1. DB-Migration ausrollen (`oidc_account_bindings`).
2. Code deployen mit `OIDC_LINK_BY_EMAIL=true` für Migrationsfenster.
3. Bestehende OIDC-Nutzer einmal neu einloggen lassen (Binding wird auto-erstellt).
4. Kontrollquery fahren: verbleibende ungebundene OIDC-User ermitteln.
5. `OIDC_LINK_BY_EMAIL=false` setzen (harte Provider-Binding-Policy).
6. `OIDC_ALLOWED_EMAIL_DOMAINS` aktivieren (falls Corporate-Domain-Pflicht).

#### Aufwand
- 8–12 Stunden (inkl. Migration, Tests, Betriebsdoku).

#### Offene Entscheidungen
1. Soll `OIDC_ALLOWED_EMAIL_DOMAINS` mandatory sein (nicht leer) in Production?
2. Soll bei `OIDC_ACCOUNT_NOT_LINKED` eine Self-Service-Linking-UI kommen oder nur Admin-Linking?
3. Soll auto-provisioning über OIDC komplett abgeschaltet werden (nur bestehende User)?

---

### 2) C2 — Bridge-Key org-scoped machen

**Befund-Referenz (Ist-Zustand):**
- `lib/integrations.js:145-183` (global "most recently updated" Key)
- `pages/api/internal/whisper-config.js:42` (kein Org-Kontext beim Resolve)
- `services/fireworks-bridge/main.py:82-85` (keine Org-Header an Callback)

#### Zielbild
1. Bridge-Konfiguration pro Org auflösen, nicht global.
2. Bridge übermittelt pro Request Org-Kontext (`X-Romaco-Org`) oder Meeting-Kontext.
3. Fallback auf operator-managed ENV-Key (`BRIDGE_TRANSCRIPTION_API_KEY`) falls kein Org-Key.

#### Patch-Skizze A — Resolver-Signatur + org-aware Lookup

**Datei:** `lib/integrations.js`

```diff
diff --git a/lib/integrations.js b/lib/integrations.js
@@
-export async function resolveBridgeTranscriptionConfig() {
-  // Pick the most-recently-updated enabled Mistral integration as the
-  // workspace whose key (and global context bias) the bridge will use.
-  try {
-    const result = await query(
-      `SELECT i.config_encrypted, s.context_bias
-         FROM organization_integrations i
-         LEFT JOIN organization_settings s ON s.organization_id = i.organization_id
-        WHERE i.provider = 'mistral' AND i.enabled = true
-        ORDER BY i.updated_at DESC
-        LIMIT 1`,
-    );
-    if (result.rows.length) {
-      const row = result.rows[0];
-      const cfg = parseConfig(row.config_encrypted);
-      if (cfg.apiKey) {
-        return {
-          apiKey: cfg.apiKey,
-          model: VOXTRAL_DEFAULT_MODEL,
-          contextBias: row.context_bias || '',
-          source: 'workspace',
-        };
-      }
-    }
-  } catch {
-    /* fall through to ENV */
-  }
-  const envKey = process.env.MISTRAL_API_KEY
+async function resolveOrgFromMeeting(platform, nativeMeetingId) {
+  if (!platform || !nativeMeetingId) return null;
+  const result = await query(
+    `SELECT organization_id
+       FROM transcriptions
+      WHERE source = 'vexa'
+        AND meeting_platform = $1
+        AND native_meeting_id = $2
+      ORDER BY id DESC
+      LIMIT 1`,
+    [platform, nativeMeetingId],
+  );
+  return result.rows[0]?.organization_id || null;
+}
+
+export async function resolveBridgeTranscriptionConfig({ organizationId, platform, nativeMeetingId } = {}) {
+  const scopedOrgId = organizationId || await resolveOrgFromMeeting(platform, nativeMeetingId);
+  if (scopedOrgId) {
+    const scoped = await query(
+      `SELECT i.config_encrypted, s.context_bias
+         FROM organization_integrations i
+         LEFT JOIN organization_settings s ON s.organization_id = i.organization_id
+        WHERE i.organization_id = $1
+          AND i.provider = 'mistral'
+          AND i.enabled = true
+        LIMIT 1`,
+      [scopedOrgId],
+    );
+    if (scoped.rows.length) {
+      const row = scoped.rows[0];
+      const cfg = parseConfig(row.config_encrypted);
+      if (cfg.apiKey) {
+        return {
+          apiKey: cfg.apiKey,
+          model: VOXTRAL_DEFAULT_MODEL,
+          contextBias: row.context_bias || '',
+          source: 'workspace',
+          organizationId: scopedOrgId,
+        };
+      }
+    }
+  }
+
+  const envKey = process.env.BRIDGE_TRANSCRIPTION_API_KEY
+    || process.env.MISTRAL_API_KEY
     || process.env.FIREWORKS_API_KEY
     || process.env.VEXA_TRANSCRIPTION_TOKEN
     || null;
   if (envKey) {
-    return { apiKey: envKey, model: VOXTRAL_DEFAULT_MODEL, contextBias: '', source: 'operator' };
+    return {
+      apiKey: envKey,
+      model: VOXTRAL_DEFAULT_MODEL,
+      contextBias: '',
+      source: 'operator',
+      organizationId: scopedOrgId || null,
+    };
   }
-  return { apiKey: null, model: VOXTRAL_DEFAULT_MODEL, contextBias: '', source: null };
+  return {
+    apiKey: null,
+    model: VOXTRAL_DEFAULT_MODEL,
+    contextBias: '',
+    source: null,
+    organizationId: scopedOrgId || null,
+  };
 }
```

#### Patch-Skizze B — Internal Endpoint nimmt Org-/Meeting-Kontext

**Datei:** `pages/api/internal/whisper-config.js`

```diff
diff --git a/pages/api/internal/whisper-config.js b/pages/api/internal/whisper-config.js
@@
   try {
-    const config = await resolveBridgeTranscriptionConfig();
+    const orgHeader = String(req.headers['x-romaco-org'] || '').trim();
+    const platformHeader = String(req.headers['x-romaco-platform'] || '').trim();
+    const nativeMeetingHeader = String(req.headers['x-romaco-native-meeting-id'] || '').trim();
+    const organizationId = /^\d+$/.test(orgHeader) ? Number(orgHeader) : null;
+
+    const config = await resolveBridgeTranscriptionConfig({
+      organizationId,
+      platform: platformHeader || null,
+      nativeMeetingId: nativeMeetingHeader || null,
+    });
     if (!config.apiKey) {
       return res.status(503).json({ code: 'NO_KEY' });
     }
     return res.status(200).json({
       apiKey: config.apiKey,
       model: config.model,
       contextBias: parseContextBias(config.contextBias),
       source: config.source,
+      organizationId: config.organizationId,
     });
   } catch (error) {
```

#### Patch-Skizze C — Bridge reicht Kontext weiter

**Datei:** `services/fireworks-bridge/main.py`

```diff
diff --git a/services/fireworks-bridge/main.py b/services/fireworks-bridge/main.py
@@
-_cache: dict = {
-    "expires": 0,
-    "api_key": None,
-    "model": DEFAULT_MODEL,
-    "context_bias": [],
-    "source": None,
-}
+_cache_by_scope: dict[str, dict] = {}
@@
-async def fetch_effective_config() -> dict:
+def _scope_key(org_id: str | None, platform: str | None, native_meeting_id: str | None) -> str:
+    if org_id:
+        return f"org:{org_id}"
+    if platform and native_meeting_id:
+        return f"meeting:{platform}:{native_meeting_id}"
+    return "global"
+
+async def fetch_effective_config(org_id: str | None = None, platform: str | None = None, native_meeting_id: str | None = None) -> dict:
@@
-    if _cache["api_key"] and now < _cache["expires"]:
-        return _cache
+    key = _scope_key(org_id, platform, native_meeting_id)
+    cached = _cache_by_scope.get(key) or {"expires": 0, "api_key": None, "model": DEFAULT_MODEL, "context_bias": [], "source": None}
+    if cached.get("api_key") and now < cached.get("expires", 0):
+        return cached
@@
-            async with session.post(
+            headers = {"X-Bridge-Secret": BRIDGE_SECRET}
+            if org_id:
+                headers["X-Romaco-Org"] = org_id
+            if platform:
+                headers["X-Romaco-Platform"] = platform
+            if native_meeting_id:
+                headers["X-Romaco-Native-Meeting-Id"] = native_meeting_id
+
+            async with session.post(
                 f"{WEBAPP_URL}/api/internal/whisper-config",
-                headers={"X-Bridge-Secret": BRIDGE_SECRET},
+                headers=headers,
             ) as resp:
@@
-                    _cache.update(
+                    cached.update(
                         api_key=body.get("apiKey"),
                         model=body.get("model") or DEFAULT_MODEL,
                         context_bias=[str(term) for term in bias if term],
                         source=body.get("source"),
                         expires=now + CACHE_TTL_S,
                     )
+                    _cache_by_scope[key] = cached
@@
-    return _cache
+    return cached
@@
 @app.post("/v1/audio/transcriptions")
 async def proxy(request: Request) -> Response:
     form = await request.form()
+    org_id = (request.headers.get("x-romaco-org") or "").strip() or None
+    platform = str(form.get("platform") or "").strip() or None
+    native_meeting_id = str(form.get("native_meeting_id") or "").strip() or None
@@
-    config = await fetch_effective_config()
+    config = await fetch_effective_config(
+        org_id=org_id,
+        platform=platform,
+        native_meeting_id=native_meeting_id,
+    )
```

#### Betreiber-Impact / Breaking Changes
1. Neuer optionaler ENV-Fallback: `BRIDGE_TRANSCRIPTION_API_KEY`.
2. Bridge-Container und Webapp müssen gemeinsam deployt werden (Signaturänderung Callback-Kontext).
3. Optionaler Protokoll-/Header-Vertrag mit Vexa-Lite (`X-Romaco-Org`) falls verfügbar.

#### Rollout-Sequenz
1. `BRIDGE_TRANSCRIPTION_API_KEY` in Secrets/ENV hinterlegen.
2. Webapp deployen (neuer resolver + whisper-config Header-Support).
3. Bridge deployen (Header-forwarding + scoped cache).
4. Smoke-Test mit mindestens zwei Orgs:
   - Org A mit eigenem Mistral-Key,
   - Org B ohne Key (muss Operator-Key nutzen),
   - Quota-/Billing-Trennung verifizieren.
5. Monitoring: callback logs um `organizationId`, `source`, `scope_key` erweitern.

#### Aufwand
- 16–24 Stunden (inkl. Integrationstests gegen Vexa-Lite).

#### Offene Entscheidungen
1. **Wichtig:** Vexa-Lite übergibt aktuell im Code keine explizite Org-ID an den Bridge-Call.
2. Falls Vexa-Lite keinen Org-Kontext senden kann: Soll das Team
   - Vexa-Lite forken und `X-Romaco-Org` ergänzen, oder
   - Org-Auflösung über `platform + native_meeting_id` erzwingen?
3. **Needs verification:** Enthält der tatsächliche Multipart-Request von Vexa-Lite immer
   `platform` und `native_meeting_id`? Falls nein, ist Header-basierter Org-Kontext Pflicht.

---

### 3) H5 — Virus-Scan `JSON.stringify`-Bug beheben + Test

**Befund-Referenz (Ist-Zustand):**
- `lib/virus-scan.js:18-19` (`const quotedPath = JSON.stringify(filePath)`)
- `lib/virus-scan.js:32-44` (quotedPath als Prozessargument)

#### Zielbild
1. Dateipfad als raw argv-Argument übergeben (kein JSON-Quoting).
2. Fail-open/fail-closed Verhalten direkt im Code dokumentieren.
3. Unit-Test mit EICAR-Signatur hinzufügen.

#### Patch-Skizze A — `lib/virus-scan.js`

```diff
diff --git a/lib/virus-scan.js b/lib/virus-scan.js
@@
 function runCommand(cmdTemplate, filePath, timeoutMs) {
   return new Promise((resolve) => {
-    // Sanitize file path to prevent command injection
-    const quotedPath = JSON.stringify(filePath);
+    // `spawn(..., { shell: false })` already prevents shell interpolation.
+    // Pass the file path as raw argv token; JSON.stringify would add literal
+    // quote chars and break scanners (path becomes "\"/tmp/file\"").
+    const safePathArg = String(filePath || '');
@@
         if (afterFile) {
-          args = [quotedPath, ...afterFile.split(/\s+/).filter(Boolean)];
+          args = [safePathArg, ...afterFile.split(/\s+/).filter(Boolean)];
         } else {
-          args = [quotedPath];
+          args = [safePathArg];
         }
       } else {
-        args = [quotedPath];
+        args = [safePathArg];
       }
@@
       const parts = cmdTemplate.trim().split(/\s+/);
       cmd = parts[0];
-      args = [...parts.slice(1), quotedPath];
+      args = [...parts.slice(1), safePathArg];
     }
@@
 export async function scanFileForViruses(filePath) {
   const mode = normalizeMode(process.env.UPLOAD_VIRUS_SCAN_MODE);
   const failOpenDefault = process.env.NODE_ENV === 'production' ? 'false' : 'true';
+  // failOpen=false => fail-closed: scanner errors/timeouts block uploads.
+  // failOpen=true  => fail-open: scanner errors/timeouts skip scan blocking.
   const failOpen = String(process.env.UPLOAD_VIRUS_SCAN_FAIL_OPEN || failOpenDefault).toLowerCase() !== 'false';
```

#### Patch-Skizze B — Unit-Test `tests/virus-scan.test.mjs`

```diff
diff --git a/tests/virus-scan.test.mjs b/tests/virus-scan.test.mjs
new file mode 100644
--- /dev/null
+++ b/tests/virus-scan.test.mjs
@@
+import test from 'node:test';
+import assert from 'node:assert/strict';
+import os from 'os';
+import path from 'path';
+import { mkdtemp, writeFile, rm } from 'fs/promises';
+import { scanFileForViruses } from '../lib/virus-scan.js';
+
+const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
+
+async function withEnv(env, fn) {
+  const prev = {};
+  for (const [k, v] of Object.entries(env)) {
+    prev[k] = process.env[k];
+    if (v === null || v === undefined) delete process.env[k];
+    else process.env[k] = String(v);
+  }
+  try {
+    await fn();
+  } finally {
+    for (const [k, v] of Object.entries(prev)) {
+      if (v === undefined) delete process.env[k];
+      else process.env[k] = v;
+    }
+  }
+}
+
+test('scanFileForViruses flags EICAR content in command mode (fail-closed)', async () => {
+  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'virus-scan-'));
+  try {
+    const samplePath = path.join(tmpDir, 'eicar.com');
+    await writeFile(samplePath, EICAR, 'utf8');
+
+    const scannerPath = path.join(tmpDir, 'fake-clam.mjs');
+    await writeFile(
+      scannerPath,
+      [
+        "import { readFileSync } from 'fs';",
+        'const target = process.argv[process.argv.length - 1];',
+        "const body = readFileSync(target, 'utf8');",
+        "if (body.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) {",
+        "  console.error('FOUND: EICAR-Test-Signature infected');",
+        '  process.exit(1);',
+        '}',
+        "console.log('OK');",
+        'process.exit(0);',
+      ].join('\n'),
+      'utf8',
+    );
+
+    await withEnv({
+      NODE_ENV: 'test',
+      UPLOAD_VIRUS_SCAN_MODE: 'command',
+      UPLOAD_VIRUS_SCAN_CMD: `${process.execPath} ${scannerPath} {file}`,
+      UPLOAD_VIRUS_SCAN_FAIL_OPEN: 'false',
+      UPLOAD_VIRUS_SCAN_TIMEOUT_MS: '5000',
+    }, async () => {
+      const result = await scanFileForViruses(samplePath);
+      assert.equal(result.clean, false);
+      assert.equal(result.skipped, false);
+      assert.match(String(result.detail || ''), /infected/i);
+    });
+  } finally {
+    await rm(tmpDir, { recursive: true, force: true });
+  }
+});
```

#### Betreiber-Impact / Breaking Changes
1. Kein Breaking Change im API-Vertrag.
2. Verhalten wird nur korrekt hergestellt: Scanner bekommt echten Dateipfad.
3. Dokumentation klarer bzgl. `UPLOAD_VIRUS_SCAN_FAIL_OPEN`.

#### Rollout-Sequenz
1. Code deployen.
2. `npm test` inkl. neuem `virus-scan.test.mjs` ausführen.
3. In Staging EICAR-Testdatei hochladen:
   - Erwartung `fail-closed`: Upload blockiert.
   - Erwartung `fail-open`: nur bei Scanner-Fehlern durchgelassen.
4. Audit-Log-Einträge `upload.virus_detected` prüfen.

#### Aufwand
- 2–4 Stunden.

#### Offene Entscheidungen
1. Soll Production grundsätzlich fail-closed bleiben (`UPLOAD_VIRUS_SCAN_FAIL_OPEN=false`)?
2. Soll zusätzlich ein expliziter Health-Check für den Scanner-Command in `/api/health` aufgenommen werden?

---

## Phasenplan (granular, mit Status)

Dieser Plan erweitert Codex' kompakten 3-Phasen-Vorschlag (oben hatte
Codex nur C1/C2/H5 in Phase 1; in der Umsetzung wurden alle Phase-1-
fähigen Befunde gebündelt). Externe Aktivitäten (Pen-Test durch
Drittanbieter, Legal-Review von DSGVO-Templates, externe Tools wie
`socket.dev`) wurden auf Romaco-Wunsch gestrichen — Verifikation wird
intern durchgeführt.

### Phase 1 — "Stop the bleeding" — ✅ ABGESCHLOSSEN (2026-05-09)

Branch: `security/phase-1-hardening` · Tests 71/71 grün · ESLint sauber

| ID | Befund | Status | Commit |
|----|--------|--------|--------|
| C1 | OIDC `email_verified` + Provider-Account-Binding + Domain-Allowlist | ✅ | `b6dafc9` |
| C2 | Bridge-Key strikt org-scoped + Operator-Fallback `BRIDGE_TRANSCRIPTION_API_KEY` | ✅ | `35442b1` |
| H2 | Vexa-Webhook konstanter 202-ACK (kein Status-Code-Leak) | ✅ | `495b923` |
| H3 | Vexa-Webhook 256-KB-Body-Cap vor Auth | ✅ | `495b923` |
| H4 | Rate-Limit IP-Extraktion zentralisiert + Direkt-Port-3000-Mapping entfernt | ✅ | `ded772b` |
| H5 | Virus-Scan-Wrapper: Token-Parser + raw `filePath` + 2 Tests | ✅ | `2a719fe` |
| H6 | Chromium-Sandbox-Default-on + Auto-`--no-sandbox`-Fallback entfernt | ✅ | `2ba3101` |
| H7 | `mdToHtml` mit DOMPurify gewrappt | ✅ | `886e3a2` |
| H10 | Last-Plattform-Admin-Schutz (PUT + DELETE) | ✅ | `f43ca97` |
| M3 | Last-Org-Owner-Schutz (PATCH + DELETE) | ✅ | `758d123` |
| M9 | Share-Endpoint nutzt `extractClientIp` statt rohem XFF | ✅ | `2954e5e` |

**Bonus:** Während H5 wurde ein zweiter Bug entdeckt — der Token-Parser
in `lib/virus-scan.js` zerlegte `clamscan --no-summary {file}` als ein
einziges `cmd`-Argument und produzierte unter `shell: false` ENOENT. Mit
gefixt im selben Commit.

**Exit-Kriterien Phase 1:** alle erfüllt.

### Phase 2 — "Defense in depth" — ✅ ABGESCHLOSSEN (2026-05-09)

Branch: `security/phase-2-defense-in-depth` · Tests 89/89 grün ·
ESLint sauber · `npm audit` zeigt 0 High/Critical-Direkt-Advisories.

| ID | Befund | Status | Commit |
|----|--------|--------|--------|
| H1 | `next` 13.5.11 → 15.5.18 (10 CVEs geschlossen) | ✅ | `57d8432` |
| H8 | Public-Share Concurrency-Cap (audio:3, stream:5) + Org-Budget `live_tts_share` (60 min/Tag/Org) + Rate-Limit auf `/share/[token]/stream` | ✅ | `b7ccefc` |
| H9 | DSGVO: Mistral Voxtral (FR) als Default statt Fireworks (US); neuer Guide `docs/gdpr-setup.md`; README/.env.example umgestellt | ✅ | `bdf231c` |
| M1 | Krypto-Hardening: HKDF-SHA256 + AAD-Binding `(field, bindingId)` + `v2:`-Prefix + idempotente Re-Encryption-Migration `npm run reencrypt-secrets` | ✅ | `32b0697` |
| M2 | `requireAdmin`/`requireAuditReader` lesen Role bei jedem Request frisch aus DB (kein JWT-Cache mehr) | ✅ | `ef11075` |
| M10 | Zentrale `assertOutboundUrl` + `safeFetch` in `lib/network-guard.js`; `fetchWithTimeout` routet darüber; Vexa/axios pre-validiert; OUTBOUND_ALLOWED_HOSTS-Allowlist | ✅ | `acd4e2b` |
| M11 | CSRF-Middleware: state-changing braucht Origin oder sec-fetch-site; `/api/auth`-Exemption auf NextAuth-Subpaths verengt | ✅ | `8c82314` |
| M13 | Slug-Suffix nutzt `crypto.randomBytes` statt `Math.random()` | ✅ | `000a481` |
| M14 | Dockerfile-Base auf `node:20.20.2-alpine3.23@sha256:fb4cd12c…` gepinnt | ✅ | `5583419` |

**Bonus-Findings während der Umsetzung:**
- H1 (Next.js): Audit-Empfehlung 14.2.35 wurde nach Audit-Datum durch
  fünf weitere High-CVEs (`GHSA-9g9p-9gw9-jx7f`, `GHSA-ggv3-7p47-pfv8`,
  `GHSA-3x4c-7xq6-9pq8`, `GHSA-q4gf-8mx6-v5v3`, plus erweiterte Range
  von `GHSA-h25m-26qc-wcjf`) eingeholt. Endziel `15.5.18` schließt
  alle. Pages Router weiterhin voll unterstützt; keine App-Code-
  Anpassungen nötig.
- M11: Neben dem Audit-Punkt zusätzlich `/api/auth/register` und
  `/api/auth/switch-org` aus der Exemption entfernt — diese teilen
  zwar das `/api/auth/`-Verzeichnis, sind aber custom Routes mit
  Cookie-Auth und müssen CSRF-geprüft werden. Webhook- und Internal-
  Endpoints kompensiert via `NON_BROWSER_AUTH_PREFIXES`.
- M1: AAD-Binding-ID generalisiert auf `bindingId` statt fix
  `organization_id`, damit `settings.mistral_api_key_encrypted`
  (per-User) ebenfalls eine eindeutige Bindung erhält (`user_id`).

**Exit-Kriterien Phase 2:** alle erfüllt.

1. ✅ `npm audit --json` zeigt keine direkten High/Critical-Advisories
   auf `next` (3 moderate transitive für `postcss`/`nodemailer`
   bleiben — Phase 3 Material, kein Direct Dependency).
2. ✅ Cost-Cap-Test: Concurrency-Cap (max 3 Audio-Streams/Token,
   `assertOrgTtsShareBudget` ≤ 60 min/Tag/Org) durch 5 neue Unit-
   Tests verifiziert (`tests/share-stream-guards.test.mjs`).
3. ✅ Krypto-Migration ist idempotent + transaktional + dry-run-fähig
   (`scripts/reencrypt-secrets.js`); ROLLBACK on jede Decrypt-
   Failure. Staging-Rollout siehe Operatorhinweis am Skript-Header.
4. ✅ Fireworks-Default ist out (`.env.example`, `README.md`,
   `README.de.md`); neuer Operator-Guide `docs/gdpr-setup.md`
   im Repo.

### Phase 3 — "Enterprise polish" (~10 Personentage)

Auth-Reifegrad + Compliance-Tiefe.

| ID | Befund | Aufwand |
|----|--------|---------|
| M4 | Pro-E-Mail Account-Lockout (progressiver Backoff) | ½ Tag |
| M5 | MFA (TOTP via `speakeasy` + Recovery-Codes), Pflicht für `admin`/`owner` | 3–5 Tage |
| M6 | Login-Timing: Dummy-bcrypt für unbekannte User | 1 h |
| M7 | OIDC-Allowlist bereits in C1; M7 = optionale `OIDC_AUTO_PROVISION=false`-Doku | 1 h |
| M8 | Logging-Redaction (`lib/observability.js`) + Audit-Metadata-Pseudonymisierung bei User-Löschung | 1 Tag |
| M12 | `bcryptjs → argon2` mit `password_hash_version`-Migration | 2 Tage |
| L1–L6 | apk-Versions-Pin, Email-Header-Sanitization, Bot-URL-Validation, DB-TLS, CSP `img-src` enger | 1 Tag gesamt |

**Exit-Kriterien Phase 3:**
1. MFA-Pflicht für `admin` + `owner` enforced.
2. Login-Timing-Differenz < 50 ms (gemessen).
3. argon2 als Default für neue Hashes; alte migrieren bei Login.
4. Production-Logs zeigen keine Stack-Traces, keine Klartext-E-Mails.

### Phase 4 — "Interne Verifikation"

Läuft parallel zu Phase 2/3, kein blockierender Pfad.

| Tätigkeit | Verantwortlich | Aufwand |
|-----------|----------------|---------|
| Frontend-XSS-Audit aller React-Komponenten (sukzessive in Sprints) | intern | 2–3 Tage |
| Retention-Schedule-Verifikation (cron läuft täglich, Logs prüfen) | DevOps | 2 h |
| Security-Regression-Tests in CI: Webhook-Replay-Test, Rate-Limit-Spoofing-Test, OIDC-Email-Verified-Test | intern | 1–2 Tage |
| GitHub-Actions-Hook für `npm audit --json` mit Fail-Gate auf High/Critical | DevOps | 2 h |
| OIDC-Migration: `OIDC_LINK_BY_EMAIL=true` initial → bestehende OIDC-User einmal einloggen → `OIDC_LINK_BY_EMAIL=false` | DevOps | nach Phase 1 Deploy |

**Operationelle Empfehlung während der Behebung:**
- ~~Vexa-Profile bleibt deaktiviert bis Phase 2 abgeschlossen ist~~ —
  Phase 2 ist abgeschlossen. Vor Aktivierung des Vexa-Profils:
  `BRIDGE_TRANSCRIPTION_API_KEY` ENV setzen (Operator-Fallback) und
  README-Kapitel `docs/gdpr-setup.md` durcharbeiten.
- OIDC mit `OIDC_AUTO_PROVISION=false` betreiben, bis Domain-Allowlist
  konfiguriert ist.
- Direkter Port-3000-Zugang auf der Maschine firewall-blocken (auch
  ohne den Compose-Fix), bis Phase-1-Deploy live ist.

**Operationelle Empfehlung nach Phase-2-Deploy:**
- `npm run reencrypt-secrets -- --dry-run` in Staging fahren, dann ohne
  `--dry-run` ausführen. Erwartete Ausgabe: `failed=0`. Skript ist
  idempotent — kann bei Bedarf erneut laufen.
- `OUTBOUND_ALLOWED_HOSTS=api.mistral.ai` in Production setzen
  (zusätzlich Resend/SendGrid-Hostname falls Email-Versand aktiv).
- `LIVE_TTS_SHARE_DAILY_MINUTES_PER_ORG` ggf. anpassen — Default 60 min.
- Bei späterem Schwenk auf weitere Provider: in `OUTBOUND_ALLOWED_HOSTS`
  ergänzen, sonst greift der safeFetch-Block.
