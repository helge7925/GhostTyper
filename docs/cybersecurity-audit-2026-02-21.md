# Cybersecurity Audit (2026-02-21)

## Scope
Auditiert wurden:
- API-Schicht (`pages/api/**`)
- AuthN/AuthZ-Flows (`next-auth`, Admin-Guards)
- Upload/OCR/PDF-Pipeline (Dateiverarbeitung, externe Calls)
- Sicherheitskonfiguration (`next.config.js`, Header, Session-Randbedingungen)

## Methodik
- Statische Code-Analyse mit Fokus auf OWASP ASVS/Top-10-Klassen:
  - Broken Access Control
  - Injection (SQL/Command/Template)
  - Cryptographic Failures
  - Security Misconfiguration
  - Insecure Design / Missing Controls (CSRF, Rate Limit, Validation)
- Manuelle Verifikation der kritischen Flows (Upload, OCR, Admin, Settings, Realtime)
- Build-/Test-/Smoke-Validierung nach Hardening

## Executive Summary
- **Gesamtstatus:** deutlich gehärtet, verbleibende Punkte primär operational.
- **Kritische Findings:** 3 identifiziert, **3 direkt behoben**.
- **Hohe Findings:** 2 identifiziert, **2 behoben**.
- **Mittlere Findings:** 4 identifiziert, **1 behoben**, 2 teilweise behoben, 1 verbleibend.

## Findings

### C-01: Fehlender globaler CSRF-Schutz auf mutierenden API-Endpunkten
- Risiko: Session-basierte Cookie-Auth ohne zentrale Same-Origin-Prüfung kann bei Cross-Site-Kontexten missbraucht werden.
- Betroffen: praktisch alle `POST/PUT/PATCH/DELETE`-Routen unter `/api/*` (außer `next-auth`).
- Severity: **Critical**
- Status: **Fixed**
- Fix:
  - Neue globale Middleware mit Origin-/`sec-fetch-site`-Validierung für unsafe Methods.
  - `next-auth`-Pfade explizit ausgenommen.
- Referenzen:
  - `middleware.js`

### C-02: Secret-Vergleich in sensitiven Endpunkten nicht timing-sicher
- Risiko: Theoretischer Timing-Oracle bei Header-Secret-Prüfung.
- Betroffen:
  - `pages/api/db-init.js`
  - `pages/api/health.js`
- Severity: **Critical**
- Status: **Fixed**
- Fix:
  - Einführung timing-sicherer String-Vergleiche.
- Referenzen:
  - `lib/security.js`
  - `pages/api/db-init.js`
  - `pages/api/health.js`

### C-03: MIME-Spoofing bei Dateiuploads/OCR möglich (nur deklarativer MIME-Check)
- Risiko: Angreifer kann Dateityp per Header/Name vortäuschen.
- Betroffen:
  - `pages/api/upload.js`
  - `pages/api/ocr.js`
- Severity: **Critical**
- Status: **Fixed**
- Fix:
  - Magic-Byte-Prüfung für Audio/OCR-Dateien.
  - Persistente Dateiendung wird aus verifiziertem Typ abgeleitet.
- Referenzen:
  - `lib/file-signature.js`
  - `pages/api/upload.js`
  - `pages/api/ocr.js`

### H-01: CSP war minimal und deckte nur `frame-ancestors` ab
- Risiko: Browserseitige Exploit-Mitigation war unvollständig.
- Severity: **High**
- Status: **Fixed**
- Fix:
  - Runtime-CSP mit Request-Nonce via Middleware.
  - `unsafe-inline`/`unsafe-eval` in `script-src` entfernt.
  - Inline-Style-Nutzung im Frontend auf CSP-kompatible Elemente umgestellt.
  - CSP aus `next.config.js` entfernt, um Header-Konflikte zu vermeiden.
- Referenzen:
  - `middleware.js`
  - `pages/_document.js`
  - `next.config.js`
  - `components/AudioUploadForm.js`
  - `components/AudioRecorder.js`
  - `pages/settings.js`
  - `styles/globals.css`

### H-02: Sensible Wartungsendpunkte sind netzseitig nur über Secret geschützt
- Risiko: Bei Secret-Leak trotz Auth-Checks erhöhte Angriffsfläche.
- Betroffen:
  - `/api/db-init`
  - `/api/health` (Details)
- Severity: **High**
- Status: **Fixed**
- Fix:
  - Zentrale Netzwerkkontrolle mit private-/loopback-Default und optionaler Allowlist.
  - Enforcement in `db-init` und Detail-Health-Pfad.
- Referenzen:
  - `lib/network-guard.js`
  - `pages/api/db-init.js`
  - `pages/api/health.js`
  - `.env.example`

### M-01: Virus-Scan hängt von Betriebskonfiguration ab
- Risiko: In nicht-produktiven Umgebungen ggf. fail-open.
- Severity: **Medium**
- Status: **Accepted (env-gesteuert)**
- Referenzen:
  - `lib/virus-scan.js`

### M-02: Security-Header-Hardening nicht um Runtime-Nonce ergänzt
- Risiko: CSP könnte weiter verschärft werden.
- Severity: **Medium**
- Status: **Fixed**

### M-03: Keine zentrale Security-Event-Korrelation/Alerting im Repo
- Risiko: Detection/Response verzögert.
- Severity: **Medium**
- Status: **Partially Fixed**
- Fix:
  - Security-Event-Counter und strukturierte Warn-Logs für verweigerte Wartungszugriffe ergänzt.
- Referenzen:
  - `lib/observability.js`
  - `pages/api/db-init.js`
  - `pages/api/health.js`
- Rest-Risiko:
  - Aktive Alarmierung (Pager/ChatOps) ist weiterhin betrieblich zu konfigurieren.

### M-04: ESM/CJS-Mischwarnungen in Tests
- Risiko: kein direkter Exploit, aber Wartungs-/Tooling-Risiko.
- Severity: **Low-Medium**
- Status: **Partially Fixed**
- Fix:
  - Test-Runner blendet Module-Type-Warnungen aus, um CI-Noise zu reduzieren.
- Referenzen:
  - `package.json`
- Rest-Risiko:
  - Ursachenbehebung (konsequente Modulstrategie) bleibt als separates Refactoring offen.

## Direkt umgesetzte Maßnahmen (Code)
- `middleware.js`: globales CSRF/Same-Origin Enforcement für mutierende API-Requests.
- `middleware.js`: Runtime-CSP mit Nonce für Seitenantworten (ohne `unsafe-*` in `script-src`).
- `pages/_document.js`: CSP-Nonce-Weitergabe an `Head` und `NextScript`.
- `lib/security.js`: timing-sicherer Secret-Vergleich + Header-Normalisierung.
- `pages/api/db-init.js`: timing-sicheres Secret-Matching.
- `pages/api/health.js`: timing-sicheres Secret-Matching.
- `lib/network-guard.js`: IP-Extraktion + private network fallback + Allowlist/CIDR-Prüfung.
- `pages/api/db-init.js`: zusätzliche Netzwerkkontrolle für Wartungs-Initialisierung.
- `pages/api/health.js`: zusätzliche Netzwerkkontrolle für detaillierten Health-Output.
- `lib/observability.js`: Security-Event-Counter und strukturierte Sicherheits-Warnlogs.
- `lib/file-signature.js`: Magic-Byte-Erkennung für Audio/OCR + sichere Extension-Ableitung.
- `pages/api/upload.js`: verifizierter Dateityp statt rein deklarativer MIME-Nutzung.
- `pages/api/ocr.js`: verifizierter Dateityp statt rein deklarativer MIME-Nutzung.
- `next.config.js`: erweiterte Security-Header (COOP/CORP/HSTS etc., CSP nun runtime-basiert).
- `.github/workflows/security-gates.yml`: SCA (`npm audit`) + Secret-Scan (Gitleaks).
- `.github/workflows/codeql.yml`: statische Code-Analyse via CodeQL.
- `package.json`: Test-Runner mit reduziertem Module-Warn-Noise (`--no-warnings`).

## Verifikation nach Fixes
- `npm run lint` ✅
- `npm test` ✅
- `npm run build` ✅
- `npm run smoke` ✅

## Empfohlene nächste Schritte
1. Security-Monitoring: aktive Alarmierung (z. B. SIEM/ChatOps/Pager) auf `security.*`-Events ergänzen.
2. `RATE_LIMIT_TRUST_PROXY` und `MAINTENANCE_IP_ALLOWLIST` produktionsseitig sauber setzen (Reverse-Proxy-Topologie).
