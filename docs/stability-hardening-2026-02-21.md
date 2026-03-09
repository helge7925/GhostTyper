# Stability Hardening Report (2026-02-21)

## Scope

Umgesetzt wurden die Findings aus dem separaten Stabilitäts-Review sowie die zuvor genannten Verbesserungsbedarfe:

- File-Cleanup bei Upload/OCR-Fehlerpfaden
- Concurrency-Guards für SSE Polling
- Atomarer Claim für Realtime-Finalisierung
- Worker-Scan-Überlappung verhindert
- Kostenlimit-Prüfung von fail-open auf fail-closed umgestellt
- DB-Connection-Timeout robuster gemacht
- Transcriptions-Listing mit Limit/Offset und kontrolliertem Search-Scope
- Konsistente E-Mail-Normalisierung in Auth/Admin/Profile
- Testabdeckung für neue kritische Utility-Pfade erweitert

## Implementierte Änderungen

### 1) Upload/OCR-Dateileaks geschlossen

- `pages/api/upload.js`
  - `safeUnlink(...)` eingeführt.
  - Temp- und persistierte Dateipfade separat getrackt.
  - Cleanup in frühen Return-Pfaden und `catch` abgesichert.
  - Ownership-Übergabe zur Transcription-Lifecycle-Verwaltung explizit.

- `pages/api/ocr.js`
  - Analoges Cleanup-Modell (`tempUploadPath`, `persistedFilePath`, `safeUnlink`).
  - Frühe Return-Pfade (fehlender API-Key/Modell, invalides Prompt) räumen persistierte Datei auf.

### 2) SSE-Überlappungen unter Last verhindert

- `pages/api/transcriptions/[id]/stream.js`
- `pages/api/realtime/sessions/[id]/stream.js`
  - `pollInFlight`-Guard ergänzt.
  - Polling-Callbacks können nicht mehr parallel laufen, auch bei langsamer DB/API.

### 3) Realtime-Finalisierung race-safe gemacht

- `lib/realtime-finalizer.js`
  - Start der Finalisierung jetzt via atomarem `UPDATE ... WHERE finalization_state IN ('idle','failed') ... RETURNING ...`.
  - Dadurch wird genau ein Worker/Request Finalizer-Owner.
  - Fehlerstatus `failed` wird nur gesetzt, wenn der aktuelle Lauf den Claim hatte.

- `pages/api/realtime/sessions/[id].js`
  - Finalisierung wird nur enqueued, wenn Session `completed` ist und `finalization_state` in `idle|failed` liegt.

### 4) Worker-Scan-Überlappungen beseitigt

- `lib/transcription-worker.js`
  - `scanRunning`-State eingeführt.
  - `runWorkerScan(...)` als serialisierter Scan-Wrapper.
  - Intervall- und Bootstrap-Scan laufen nicht mehr parallel.

### 5) Kostenlimit-Prüfung fail-closed

- `lib/usage.js`
  - Neuer Fehler `CostLimitCheckUnavailableError` (`code: COST_CHECK_UNAVAILABLE`).
  - Bei DB-/Prüfungsfehlern wird nicht mehr `allowed: true` zurückgegeben, sondern ein Fehler geworfen.

- Aufrufer angepasst:
  - `pages/api/text-ai.js`
  - `pages/api/translate.js`
  - `pages/api/templates/generate.js`
  - `pages/api/model-assistant.js`
  - `pages/api/realtime/sessions/[id]/ingest.js`
  - `pages/api/ocr.js`
  - `pages/api/workflows/execute.js`
  - `lib/transcription-worker.js`
  - `lib/manual-analysis.js`

  Verhalten:
  - Kostenlimit erreicht/Guardrail: `429`
  - Kostenlimitprüfung nicht verfügbar: `503`

### 6) DB-Verbindungsaufbau robuster

- `lib/db.js`
  - `connectionTimeoutMillis` von starr `2000` auf env-gesteuert mit Default `5000` erhöht.
- `.env.example`
  - `DB_CONNECTION_TIMEOUT_MS=5000` ergänzt.

### 7) Transcriptions-Liste stabilisiert

- `lib/transcriptions-list.js` neu:
  - Parsing/Clamp für `search/scope/limit/offset`.
- `pages/api/transcriptions/index.js`:
  - Limit/Offset eingeführt.
  - Search-Scope (`name` vs `full`) mit Guard (full erst ab Suchlänge >= 3).
- `lib/api.js`:
  - `getTranscriptions(...)` unterstützt Legacy-String und Optionsobjekt.
- `pages/transcriptions.js`:
  - Initial-Load und Reset-Suche nutzen kontrollierte Limits.
  - Search-Request explizit mit Scope/Limit.

### 8) E-Mail-Konsistenz

- `lib/email.js` neu:
  - `normalizeEmail`, `isValidEmail`.
- Konsumiert in:
  - `pages/api/auth/[...nextauth].js` (Login via `lower(email)`),
  - `pages/api/admin/users/index.js`,
  - `pages/api/admin/users/[id].js`,
  - `pages/api/user/profile.js`.
- `lib/db-init.js`:
  - Index `idx_users_email_lower` ergänzt.

## Test- und Debug-Protokoll

### Lokal erfolgreiche Läufe

- `npm run lint` -> erfolgreich
- `npm test` -> erfolgreich (13/13 Tests)
- `npm run build` -> erfolgreich
- `npm run smoke` -> erfolgreich

### Beobachtete Umgebungsschwankungen

- `npm run smoke:full` ist weiterhin nicht deterministisch in dieser Umgebung:
  - sporadisch `EPERM: listen 0.0.0.0` im `next build`-Schritt,
  - anschließend teilweise Docker-Socket-`permission denied`.

Das tritt im kombinierten Voll-Lauf auf, obwohl `npm run build` und `npm run smoke` jeweils separat erfolgreich laufen. Bewertung: Runner-/Umgebungsproblem, kein reproduzierbarer App-Codefehler.

## Testabdeckung erweitert

Neue Tests:

- `tests/email-utils.test.mjs`
- `tests/transcriptions-list.test.mjs`

Bestehende Tests weiterhin grün:

- `tests/table-calculations.test.mjs`

## Offene Hinweise

- Node-Warnung `MODULE_TYPELESS_PACKAGE_JSON` bleibt bestehen (ESM/CJS-Mix bei `.js` ohne globales `"type": "module"`).
- Build-Warnung `--localstorage-file` erscheint weiterhin, derzeit ohne funktionale Auswirkung.
