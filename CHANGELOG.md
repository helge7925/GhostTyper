# Changelog

Alle relevanten Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Changed
- **Service rename: `fireworks-bridge` → `voxtral-bridge`.** Der
  Transkriptions-Proxy hieß historisch `fireworks-bridge` (als die
  Upstream-STT noch Fireworks AI war), spricht aber seit der Mistral-
  Migration ausschließlich Voxtral. Umbenannt: Verzeichnis
  `services/voxtral-bridge/`, Image-Tag `voxtral-bridge:prod`,
  Container `transkription-voxtral-bridge`, Compose-Service
  `voxtral-bridge`, Hostname-Referenzen in `vexa-lite`. Der
  `FIREWORKS_API_KEY`-Env-Fallback bleibt als Legacy-Alias für ältere
  Setups.
- **Per-Sprache Voxtral-TTS-Stimme + Chinesisch.** `lib/tts.js` mappt
  DE/EN/ZH/FR/IT/ES/PT/NL/AR/HI auf Voxtral-Preset-Stimmen; ZH ohne
  eigenen Preset fällt auf `casual_male` (englische Stimme) zurück.
  STT-Dropdown im Dialog + In-Call um ZH/FR/IT erweitert.

### Fixed
- **Voxtral-TTS-Modell-ID korrigiert.** `voxtral-tts-latest` (existiert
  nicht) → `voxtral-mini-tts-2603`. Voice-Feld umbenannt `voice_id` →
  `voice` (live-API verlangt `voice`, OpenAPI-Doku-Bug). Default-Stimme
  `casual_male` aus der offiziellen Hugging-Face-Code-Beispiel-Doku.
- **TTS-Resilienz.** `voxtralTts` wiederholt transiente Fehler (429 /
  5xx / Netzwerk-Abort) mit Exponential-Backoff (Standard 3 Versuche),
  statt das Audio-Segment beim ersten Hiccup still zu verwerfen.
  Permanente 4xx (falsches Modell/Voice/Key) scheitern weiterhin sofort.
  Tunebar via `TTS_MAX_ATTEMPTS` / `TTS_RETRY_BASE_MS`.
- **Fehlgeschlagene Übersetzung wird nicht mehr als Audio gesprochen.**
  Wenn Mistral-Translate ausfällt, echot die Bridge zwar den Quelltext
  für die UI-Konsistenz, markiert ihn aber mit `translationFailed` —
  der Audio-Inject-Hook überspringt solche Segmente, damit der Bot
  nicht den unübersetzten Originaltext in der Zielstimme vorliest.
- **Chat-Post-Fehler sichtbar in der Meeting-Timeline.** DSGVO-Hinweis-
  und Share-Link-Poster legen bei Sende-Fehler (z.B. Plattform ohne
  Bot-Chat-Handler wie aktuell Nextcloud Talk) jetzt ein
  `*_failed`-Transcription-Event an, statt nur ins Server-Log zu
  schreiben — der Host sieht, dass er manuell ankündigen/teilen muss.

### Security / Ops
- **`.dockerignore`** schließt jetzt `.env` / `.env.*` aus, damit lokale
  Secrets nie ins Image gebacken werden.
- **`.env.example`** dokumentiert die neuen TTS-Variablen
  (`MISTRAL_TTS_MODEL`, `MISTRAL_TTS_VOICE`, `TTS_HTTP_TIMEOUT_MS`,
  `TTS_MAX_ATTEMPTS`, `TTS_RETRY_BASE_MS`).

### Tests
- **+19 Unit-Tests** (gesamt 106): `tests/permissions.test.mjs` deckt die
  Rollen→Permission-Matrix + Fail-Closed-Verhalten ab,
  `tests/secrets.test.mjs` deckt AES-256-GCM Round-Trip, Versions-Prefix,
  Auth-Tag-Integrität (Tamper → null) und Wrong-Key-Verhalten ab.

## [0.4.0] – 2026-05-07

### Added
- **Nextcloud Talk als vierte Meeting-Plattform** (via Vexa-Fork). Neuer
  Pattern-Eintrag in `lib/api/vexa.js → MEETING_URL_PATTERNS` für Talk-
  URLs (`/call/<token>` und `/index.php/call/<token>`); Erweiterung von
  `pages/api/meetings/index.js → SUPPORTED_PLATFORMS`. Der Bot-Code
  selbst lebt in einem separaten Repo
  ([helge7925/vexa, Branch `feat/nextcloud-talk-adapter`](https://github.com/helge7925/vexa))
  und liefert ein eigenes Image
  `ghcr.io/helge7925/vexa-bot-talk:<upstream>-talk.<patch>`.
- **`VEXA_LITE_IMAGE` Override** in `config/docker-compose.prod.yml`:
  Operator kann das Vexa-Lite-Image per ENV-Variable austauschen
  (Default = upstream Vexa-AI; Override = Talk-Fork). Default-Verhalten
  unverändert für bestehende Deployments.
- **Vexa-Operator-Dashboard** auf `127.0.0.1:${VEXA_DASHBOARD_HOST_PORT:-3300}`
  exposed. Ist bereits im `vexa-lite`-Image enthalten (Vexa-AIs eigene
  Next.js-UI: Bot-Health, VNC, Live-Transcript-Debug). Auth läuft gegen
  Vexa-admin-api, nicht gegen GhostTyper-NextAuth — bewusst Operator-
  only, lokalhost-bind by default.
- **Tests** (`tests/vexa-adapter.test.mjs`): drei neue Cases für die
  Talk-URL-Erkennung (modern path, legacy `/index.php/`, negative cases).

### Fixed
- Voxtral-Bias-Filter in `lib/ai-service.js`: ungültige Bias-Terms
  (Whitespace-/Komma-haltig) werden vor dem Mistral-Call gestript,
  Cap auf 64 Terms / 1000 Zeichen, damit ein zu großer
  `context_bias` aus Workspace-Settings nicht den ganzen
  Transcription-Run mit einem 422 abbricht.
- Mistral-Fehler-Logging: `transcribeAudio()` schreibt jetzt das
  vollständige Validation-Detail in den Log statt eines
  unbrauchbaren `[object Object]`.

### Docs
- `docs/architecture.md`: erklärt jetzt warum der Service noch
  „fireworks-bridge" heißt (Legacy-Name, zeigt heute auf Mistral
  Voxtral) und welche Customer-Forks abweichen.
- `docs/vexa-integration.md`: Image-Pin-Hinweis korrigiert,
  `VEXA_LITE_IMAGE`/`VEXA_DASHBOARD_HOST_PORT` dokumentiert,
  neue Operator-Dashboard-Sektion.
- `docs/docker-setup.md`: kompletter Rewrite — alte
  „paperless-db"-Copy-Paste-Reste, Postgres-13-Stand und
  fehlende Vexa-Container-Beschreibung ersetzt durch
  aktuellen Stand.
- `docs/api-specification.md`: Header-Stand auf 2026-05-07
  aktualisiert, falsche `localhost:5000`-Basis-URL korrigiert,
  Auth-Header-Liste vervollständigt.

## [0.3.0] – 2026-05-03

Erstes öffentliches Release auf GitHub. Project switched from internal
1.x numbering to 0.x to reflect public-beta status.



### Added
- **Remote-Meeting-Transkription (Vexa Lite + Cortecs Whisper):** Bot tritt Google Meet, Microsoft Teams oder Zoom bei und liefert das Transkript in den bestehenden Workflow (Editor, Auto-Analyse, Export).
  - **Zwei-Stufen-Opt-in**: (1) `docker compose --profile vexa up` aktiviert den Bundle-Container, (2) Org-Admin schaltet die Integration in den Settings frei. Vor beiden Schaltern ist der „Remote-Meeting"-Button unsichtbar; ohne Profil läuft kein Vexa-Container.
  - **Compose-Bundle**: `config/docker-compose.prod.yml` enthält `vexa-lite` (gepinnt `vexaai/vexa-lite:0.10.4`, 2 GB RAM, Health-Check) + `vexa-db-init` (legt `vexa`-Datenbank in derselben Postgres-Instanz an). Browser-Bots laufen als Kindprozesse im Vexa-Container und enden mit dem Meeting — keine Docker-Socket-Mounts, keine Leichen.
  - **ENV-Fallback**: `VEXA_BASE_URL` und `VEXA_ADMIN_API_TOKEN` aus dem Compose-Stack werden vom neuen `resolveVexaConfig()` als Operator-Default genutzt; Org-Settings überschreiben (für externe Vexa-Deployments).
  - **Webhook-Auto-Registrierung**: beim ersten Bot-Start je User registriert GhostTyper die Webhook-URL automatisch via `setUserWebhook` an Vexa — kein manueller `curl`-Schritt mehr.
  - **DB**: neue Spalten auf `transcriptions` (`source`, `meeting_platform`, `native_meeting_id`, `external_meeting_id`, `bot_status`, `meeting_started_at/ended_at`); neue Tabellen `organization_integrations` (verschlüsselte Provider-Config), `vexa_user_tokens` (per-User-API-Keys, AES-256-GCM), `vexa_webhook_events` (Idempotenz).
  - **RBAC**: neue Permissions `meeting.start` (member+), `meeting.admin` (admin+).
  - **Vexa-Client** (`lib/api/vexa.js`): `startBot/stopBot/updateBotConfig/getTranscript/ensureVexaUser/createVexaUserToken/setUserWebhook/adminHealthCheck` + `parseMeetingUrl` (Meet/Teams/Zoom) + `mapVexaTranscriptToGhostTyper`.
  - **Live-Bridge** (`lib/vexa-bridge.js`): Polling-Daemon (2s) speist Vexa-Segmente in die existierende SSE-Pipeline — DocumentEditor unverändert.
  - **API-Endpunkte**: `POST/DELETE /api/meetings`, `PUT /api/meetings/[id]/config`, `POST /api/webhooks/vexa` (HMAC, Idempotenz, ±5 min Replay-Schutz), `POST /api/admin/vexa/reconcile` (Cron-Backstop mit `RECONCILE_API_SECRET`), `GET/PUT /api/organizations/integrations/vexa` + `/test`.
  - **UI**: „Remote-Meeting"-Button in der Transkriptionsliste, `MeetingStartForm` (URL-Erkennung, Sprache, **Pflicht-Consent-Checkbox**), `MeetingControlBar` in der Detail-Seite (Sprache wechseln, Bot stoppen), neuer Settings-Tab „Integrationen → Vexa Meeting-Bot" mit Verbindungstest.
  - **Persistenz-Hook**: `meeting.completed`-Webhook → bestehende `transcriptions`-Row (`source='vexa'`) → `auto_analyze` triggert `runManualAnalysisJob` automatisch.
  - **i18n**: deutsche und englische Strings für `meeting.start.*` und `settings.integrations.vexa.*`.
  - **Tests**: 13 neue Tests (URL-Parser, Transcript-Adapter, Webhook-HMAC inkl. Replay/Tamper/Wrong-Secret).
  - **Doku**: `docs/vexa-integration.md` (Operator-Guide mit Vexa-Lite-/Cortecs-Setup, Webhook-Registrierung, Reconcile-Cron, DSGVO-Hinweise, Troubleshooting).
- **Workspace/Org-Layer Phase 4 (Multi-Tenancy, Cross-Device-UX-Refactor):**
  - **DB-Schema** (additiv, `lib/db-init.js`): neue Tabellen `organizations`, `organization_members`, `organization_invites`, `organization_settings` + `organization_id BIGINT NULL` auf transcriptions, templates, template_categories, folders, usage_log, api_keys, audit_log, transcription_events; passende Indexe.
  - **RBAC**: `lib/permissions.js` mit Rollen `viewer/auditor/member/admin/owner` und 18 Permissions, fail-closed `hasPermission()` + `assertPermission()`.
  - **Middleware**: `lib/api/with-org-scope.js` als HOC für Next.js-API-Handler — resolved aktive Org, prüft Membership + Permission, setzt `req.userId`/`req.org`/`req.role`/`req.memberships`.
  - **Hooks**: `lib/use-current-org.js` (Liste, aktive Org, `switchOrg()`), `lib/use-permission.js`.
  - **NextAuth-Callbacks**: JWT enthält jetzt `currentOrganizationId` + `organizations[]`; `update({ currentOrganizationId })` triggert Server-Roundtrip + Re-Issue.
  - **Backfill-Skript** `scripts/migrate-to-organizations.mjs` (`--dry-run` / `--apply` / `--enforce`): legt Personal-Org pro User an, weist alle bestehenden Records zu, optional NOT-NULL-Flip.
  - **API-Endpoints (27)** auf Org-Scope umgestellt: transcriptions/* (incl. analyze/process/stream/download/save-doc), templates, template-categories, folders, upload, settings, usage, audit-log, glossary/suggestions, knowledge-prep/text, model-assistant, text-optimization, ocr, translate, translate/file, templates/generate.
  - **Org-Management-APIs**: `pages/api/organizations/{index,members,invites,settings}.js` + `pages/api/auth/switch-org.js`.
  - **UI**:
    - `components/WorkspaceSwitcher.js` in der TopBar (DropdownMenu mit aktiver Org, Rollen, Plan, Switch-Action).
    - `pages/settings/organization/index.js` (Stat-Tiles, Quick-Links).
    - `pages/settings/organization/members.js` (Member-Liste mit Rollen-Inline-Edit, Invite-Form, offene Einladungen, Confirm-Dialog).
    - `pages/audit.js` mit Severity-Badges, Filter (Action/Severity), CSV-Export.
    - CommandPalette erweitert um "Workspace verwalten" und "Audit-Log" (nur bei Permission).
  - **Audit-Log lib** (`lib/audit-log.js`): `organizationId`-Parameter, neue `listAuditEventsForOrg()` mit `since`/`until`/`action`/`severity`-Filtern.

### Changed
- Alle Hot-Path-API-Endpoints filtern jetzt mit `WHERE organization_id = $1` (Personal-Org enthält die bisherigen User-Daten — semantisch unverändert).
- `INSERT INTO transcriptions` in upload/ocr/knowledge-prep-text/translate/file um `organization_id` ergänzt.

- **Editor-Routen, Settings & Pagination Phase 3 (Cross-Device-UX-Refactor):**
  - `pages/transcriptions/[id]/edit.js` und `pages/transcriptions/[id]/table.js` — eigene Routen für DocumentEditor/TableEditor mit Deep-Link, "in neuem Tab", Browser-Back. Editor-Routen rendern ohne App-Shell (`NO_LAYOUT_ROUTES`-Set in `pages/_app.js`).
  - DocumentEditor: dirty-Tracking, `beforeunload`-Guard und shadcn `AlertDialog` beim Close-Button mit "Verwerfen / Weiter bearbeiten".
  - Settings-Tabs adaptiv: native `<select>` (< md) / horizontale Tabs (md..lg) / **vertikale Sidebar-Tabs** in `grid-cols-[240px_1fr]` (≥ lg).
  - Pagination der Transkriptions-Historie: initial 100 Items + "Weitere laden"-Button (statt 500 auf einen Schlag); Skeleton-Loading während Initial-Fetch.
  - `components/ui/skeleton.js` — wiederverwendbare Skeleton-Komponente (respektiert reduced-motion).

### Changed
- `pages/transcriptions/[id].js` — `showEditor`-State entfernt; "Im Editor öffnen"-Buttons und Inline-Links sind jetzt `<Link href>` zu `/transcriptions/[id]/edit` bzw. `/table`. `?autoEditor=1` redirected automatisch zur richtigen Route.
- Settings-Tab-Konstante nutzt `lucide-react` (Mic, FileText, Table, Languages, KeyRound) statt Inline-SVGs.
- `/transcriptions/[id]`-Bundle halbiert (14.7 → 7.27 kB durch Code-Splitting der Editor-Module).

- **App-Shell Phase 2 (Cross-Device-UX-Refactor):**
  - Globaler UI-State via `zustand` (`lib/store/ui-store.js`): `sidebarOpen`, `sidebarCollapsed` (persistiert), `commandPaletteOpen`.
  - Zentrale Z-Order in `lib/constants/z-index.js`.
  - shadcn-Komponenten erweitert: `components/ui/sheet.js` (Radix-Dialog mit Side-Varianten) und `components/ui/command.js` (cmdk-Wrapper).
  - `components/CommandPalette.js` — globale ⌘K-Palette mit Navigation, Aktionen, Theme-Toggle und Logout.
  - `components/TopBar.js` — sticky Top-Bar mit Hamburger/Collapse-Toggle, zentriertem Such-/Befehls-Trigger (md+), Theme-Toggle und Profil-Dropdown (Profil/Einstellungen/Admin/Logout).
  - `components/BottomNav.js` — 5-Routen-Bottom-Nav für Mobile mit iOS-`safe-area-inset-bottom`.
  - Adaptive `Sidebar`: persistent kollapsible Rail (`xl:flex`, 256/64px mit Tooltips im Collapsed-Modus) + Sheet-Drawer (`xl:hidden`).
  - Globale ⌘K / Ctrl+K / `/` Keyboard-Shortcuts in `pages/_app.js` (überspringt input/textarea/contentEditable).

### Changed
- **Layout** komponiert die neue Shell (TopBar + Sidebar + BottomNav) und reagiert auf `sidebarCollapsed` mit `xl:pl-16/64`.
- **Z-Index aufgeräumt**: shadcn Dialog/AlertDialog 50 → 70, Tooltip 50 → 90, DropdownMenu 50 → 80, Sheet-Overlay 40 → 45; Full-Screen-Editoren (DocumentEditor/TableEditor/Settings-Overlays) 100/110 → 60 — Modale liegen jetzt korrekt über Editoren.
- `Layout.js` rendert auch ohne Session eine schlanke TopBar (Logo + Theme-Toggle).

### Removed
- Touch-Swipe-Edge-Open-Handler aus alter Sidebar (Hamburger reicht; bei Bedarf später als `useEdgeSwipe`-Hook zurück).

- **Design-System Phase 1 (Cross-Device-UX-Refactor):**
  - Semantische Token-Schicht über CSS-Variablen mit Light- und Dark-Mode (`styles/globals.css`).
  - `lib/theme-context.js` mit `ThemeProvider`, `useTheme()`, `localStorage`-Persistenz und `prefers-color-scheme`-Fallback; FOUC-freier Inline-Init in `pages/_document.js`.
  - `components/ThemeToggle.js` in der Sidebar; `<meta theme-color>` in `Layout.js` jetzt theme-abhängig.
  - shadcn/ui-Komponenten in `components/ui/`: Button (cva), Dialog, AlertDialog, Tooltip, DropdownMenu, Separator, Sonner-Toaster (theme-aware).
  - Radix Primitives (`@radix-ui/react-{dialog,alert-dialog,tooltip,dropdown-menu,separator,slot}`), `clsx`, `tailwind-merge`, `class-variance-authority`, `tailwindcss-animate`, `sonner`, `lucide-react`.
  - `lib/utils.js` mit `cn()` Helper.
  - Migrations-Skripte: `scripts/migrate-tokens.mjs` (353 hartkodierte `white/[X]`-/`black/X`-Klassen) und `scripts/cleanup-tokens.mjs` (987 Legacy-Tokens) mit `--apply`/`--verbose`/Dry-Run.

### Changed
- **Tailwind-Config rein semantisch** — Compat-Aliase (`dark.*`, `text.*`, `accent.orange/cyan/green/yellow/red`) entfernt; Tokens jetzt: `canvas`, `surface`, `surface-elevated`, `primary`, `secondary`, `muted`, `accent.{DEFAULT,strong}`, `success`, `warning`, `danger`, `info`, `subtle`, `emphasis`, `hover-subtle/hover/hover-strong`, `overlay`.
- `components/ConfirmDialog.js` auf Radix `AlertDialog` migriert (Focus-Trap, ESC, Backdrop-Click jetzt out-of-the-box; öffentliches Interface unverändert).
- `components/AudioRecorder.js` Canvas liest Farben aus CSS-Variablen — reagiert live auf Theme-Switch.
- Inline-SVGs in `Layout`, `Sidebar`, `ThemeToggle` durch lucide-Icons ersetzt; aktive Nav-Links bekommen `aria-current="page"`.

- **Produktivitätsfunktionen (Punkte 1-3)**:
  - Auto-Glossar für Kontextbegriffe aus Historie (`GET /api/glossary/suggestions`).
  - Intelligente Modellauswahl mit Kosten-/Token-Vorschau (`POST /api/model-assistant`).
  - 1-Klick-Workflows im Text-Assistenten (`GET /api/workflows`, `POST /api/workflows/execute`).
- **Wissensgraph-Generator**:
  - Native Integration der Knowledge-Graph Generierung.
  - Interaktives Rendering von Entitäten und Relationen mittels `vis-network`.
  - PNG-Export-Funktionalität des generierten Graphen.
- **Team Realtime**:
  - Neue Realtime-Seite `/realtime` für Live-Transkript, Live-Dokument und Live-Wissensgraph.
  - Neue Realtime-API-Endpunkte:
    - `GET|POST /api/realtime/sessions`
    - `GET|PATCH /api/realtime/sessions/[id]`
    - `POST|DELETE /api/realtime/sessions/[id]/members`
    - `POST /api/realtime/sessions/[id]/ingest`
    - `GET /api/realtime/sessions/[id]/stream`
  - Neue DB-Tabellen:
    - `realtime_sessions`
    - `realtime_session_members`
    - `realtime_session_events`
- **Workflow Editor + Versionierung**:
  - Eigene Workflows als versionierte Definitionen in der DB.
  - Rollback auf frühere Versionen.
  - Neue API-Endpunkte:
    - `POST /api/workflows` (Workflow speichern/neue Version)
    - `DELETE /api/workflows/[workflowId]` (deaktivieren)
    - `GET /api/workflows/[workflowId]/versions`
    - `POST /api/workflows/[workflowId]/rollback`
- **Audit-Log für kritische Aktionen**:
  - Neue DB-Tabelle `audit_log`.
  - Neuer Endpunkt `GET /api/audit-log`.
  - Protokollierung von sicherheits- und betriebsrelevanten Aktionen (z. B. Settings, Workflow-Versionen, Realtime-Mitgliederverwaltung, Upload-Blockierungen).
- **Upload Security Hook**:
  - Optionaler Virus-Scan vor Persistenz des Uploads (`UPLOAD_VIRUS_SCAN_*`).
- **Budget Guardrails (pro Mitglied/Account)**:
  - Neues Setting `member_monthly_budget_limit`.
  - Guardrail-Prüfung mit Prognose vor KI-Aufrufen in Text-AI, Übersetzung, Workflows und Realtime-Audio-Chunks.
- **Sketch Summary / Lernskizze (Gemini)**:
  - Neue Seite `/sketch` zur Bildgenerierung aus Lerntext.
  - Neuer Endpunkt `POST /api/sketch-summary` (Gemini `gemini-3-pro-image-preview`).
  - Neue Settings-Unterstützung für `google_api_key` / `google_api_key_encrypted` inkl. UI-Statusanzeige.
  - Studio-Einstellungen vor Generierung: Layout-Modus, Detailgrad und Fokus.
  - Mehrstufige Engine:
    - Semantik-Extraktion (`TEXT` -> Struktur-JSON),
    - Illustrationsplanung pro Block (`icon` + `motif`),
    - deterministisches SVG-Rendering mit einheitlicher Typografie/Layoutregeln.
  - Ausgabe jetzt vektorbasiert (`image/svg+xml`) im festen Querformat (16:9, 1920x1080).
- **Datentabelle (NotebookLM-ähnlicher Modus)**:
  - Neue Seite `/datentabelle` als separater Aufbereitungsmodus.
  - Unterstützung für alle drei Quellen: Audio, Text und OCR.
  - Neuer Built-in Template-Key `data_table` inkl. eigenem Analyseprompt.
  - Dynamische Tabellen-Normalisierung in `rows + table_schema + analysis_meta` für einheitliche Darstellung in `TableRenderer`.

### Changed
- **Tabellen-Vorlagen Editor V2**:
  - Fokus auf visuelle Bedienung statt technischer Felder.
  - Schnellstart-Presets, vereinfachte Spaltenanlage und bessere Formelhilfe.
  - Expertenansicht für interne Keys optional.
- **Table-Extraction Prompt**:
  - Klarere Regeln für wiederkehrende Tabellenstruktur im Text.
  - Striktere JSON-Ausgabe ohne zusätzliche Felder.
- **Model Assistant/Kostenvorschau**:
  - Ampellogik (grün/gelb/rot) zur Startentscheidung vor Ausführung.
- **Realtime Robustheit**:
  - Duplikat-Erkennung für wiederholte Chunks.
  - Finalisierungs-Pass bei Session-Abschluss mit `finalization_state`.
- **Tabellenanalyse-Pipeline**:
  - Serverseitige Normalisierung/Validierung gegen Schema.
  - Persistenz von `analysis_meta` inklusive `missing_fields_by_row`.
  - Frontend-Highlight für unvollständige Pflichtfelder pro Zeile.
- **Sketch/Settings UX**:
  - Einheitliche Bezeichnung „Lernskizze“ in Navigation und Seite.
  - Verbesserte Ladezustände/Disable-Logik auf der Sketch-Seite.
  - Account-Tab mit expliziten „Key entfernen“-Flows und Save-/Clear-Loadingstates.
  - Toast-Positionierung für mobile Viewports verbessert.
- **Realtime Session-Formular**:
  - Start-Button in der Session-Erstellung ist nun responsive und bleibt auch auf kleinen Viewports innerhalb der Box.
- **Dashboard API-Status**:
  - Zweiter API-Status ergänzt: zusätzlich zur Google-API wird nun auch der Mistral-API-Status separat angezeigt.
- **Navigation/Labeling**:
  - Neuer Sidebar-Eintrag `Datentabelle`.
  - Historie- und Detailansicht zeigen den Modus konsistent als `Datentabelle`.

### Fixed
- **PDF-Renderer**:
  - Robuster Chromium-Fallback mit automatischem `--no-sandbox` in restriktiven Container-Umgebungen.
- **Tabellen-Pipeline**:
  - Korrekte Persistenz von `analysis_type='table'` und `table_schema`.
  - API-Rückgaben in Transkriptionsdetails für Tabellenausgaben vervollständigt.
- **Settings API Kompatibilität**:
  - `POST /api/settings` und `PUT /api/settings` werden beide unterstützt.
- **Sketch Fehlerbehandlung**:
  - präzisere Fehlerklassifikation für API-Key/Berechtigung, Quota und Modellantworten.
  - Robuster Fallback auf lokale Layout-/Illustrations-Engine bei fehlender oder unvollständiger Modellantwort.
  - Kostenlimit wird im Sketch-Flow konsistent geprüft und als `429` zurückgegeben.

## [1.2.0] - 2026-02-19

### Added
- **Template-Kategorien**: Vorlagen können jetzt in selbst erstellten Kategorien organisiert werden.
  - Neue Datenbank-Tabelle `template_categories` (id, user_id, name, color, position).
  - Neue Spalte `templates.category_id` für Kategorie-Zuordnung.
  - Kategorien erstellen, bearbeiten, löschen direkt in den Einstellungen.
  - Farbcodierte Kategorie-Badges für visuelle Unterscheidung.
- **Volltext-Suche in Transkriptionen**: Durchsucht jetzt auch Transkript-Inhalte, nicht nur Dateinamen.
  - Server-Side Search über `text` und `analysis` Felder via `?search=` Parameter.
  - Debounced Search im Frontend mit Loading-Indicator.
  - PostgreSQL ILIKE für case-insensitive Suche.

### Changed
- **Quick-Search UX**: Suchfeld zeigt jetzt Lade-Spinner während der Suche.
- **API-Erweiterung**: `getTranscriptions(search)` unterstützt jetzt optionalen Suchparameter.

### Technical
- Neue API-Endpunkte:
  - `GET /api/template-categories` - Alle Kategorien auflisten.
  - `POST /api/template-categories` - Neue Kategorie erstellen.
  - `PUT /api/template-categories/[id]` - Kategorie aktualisieren.
  - `DELETE /api/template-categories/[id]` - Kategorie löschen.
- Neue Frontend-Funktionen in `lib/api.js`:
  - `getTemplateCategories()`, `createTemplateCategory()`, `updateTemplateCategory()`, `deleteTemplateCategory()`.
- Datenbank-Migration in `lib/db-init.js`:
  - Tabelle `template_categories` mit Index.
  - Spalte `templates.category_id` mit Foreign Key.
- Frontend-Erweiterungen in `pages/settings.js`:
  - Kategorien-Section mit CRUD-UI.
  - Kategorie-Badges mit Farb-Indikator.

## [1.1.0] - 2025-02-18

### Added
- **Tabellen-Vorlagen**: Vollständig neue Funktion zur strukturierten Datenextraktion.
  - Neuer Vorlagen-Typ `table` neben bestehenden `text` Vorlagen.
  - Visueller Schema-Editor (`TableSchemaBuilder`) für Spalten-Definition.
  - Unterstützte Datentypen: Text, Zahl, Währung, Datum.
  - Berechnete Felder mit Formeln (z.B. `menge * preis`).
  - Automatische Berechnung von Summen in der Fußzeile.
  - KI-gestützte Generierung von Tabellen-Schemas aus Beschreibungen.
- **Interaktive Tabellen-Ansicht** (`TableRenderer`):
  - Inline-Editing von extrahierten Daten.
  - Dynamische Berechnung von Formel-Spalten.
  - Export als CSV, Excel (XLSX) und HTML.
  - Zeilen hinzufügen/entfernen im Edit-Modus.
- **Neue Datenbank-Spalten**:
  - `templates.template_type` ('text' | 'table').
  - `templates.table_schema` (JSONB für Schema-Definition).
  - `transcriptions.analysis_type` ('text' | 'table').
  - `transcriptions.table_schema` (JSONB für zugehöriges Schema).
- **API-Erweiterungen**:
  - Templates API unterstützt jetzt `template_type` und `table_schema`.
  - Analyse-Flow erkennt Tabellen-Vorlagen und extrahiert strukturierte JSON-Daten.
- ** Neue Bibliothek**: `xlsx` für Excel-Export-Funktionalität.
- **Dokumentation**: Umfassende technische Dokumentation der Tabellen-Features.

### Changed
- **Settings-Seite**: Aufgeteilt in "Text-Verarbeitung" und "Tabellen-Verarbeitung".
- **Vorlagen-Liste**: Zeigt jetzt Icons und Metadaten (Spalten-Anzahl, Berechnungen).
- **Transkriptions-Detailansicht**: Rendert `TableRenderer` für Tabellen-Analysen.
- **Template-Generierung**: Unterscheidet zwischen Text- und Tabellen-Prompts.

### Technical
- Neue Hilfsmodule:
  - `lib/table-calculations.js`: Formel-Berechnung, Validierung, Prompt-Generierung.
  - `lib/table-export.js`: Export-Funktionen (CSV, Excel, HTML).
  - `lib/table-template-generator.js`: Schema-Generierung aus Beschreibungen.
- Neue React-Komponenten:
  - `components/TableSchemaBuilder.js`: Visueller Editor für Tabellenschemas.
  - `components/TableRenderer.js`: Interaktive Tabellen-Komponente.

## [1.0.1] - 2025-02-17

### Fixed
- Audio-Upload auf iOS: `capture="environment"` entfernt, damit Dateiverwaltung statt Kamera geöffnet wird.
- Editor: Ein-/Ausrücken von Bulletpoints jetzt möglich (Buttons für `indent`/`outdent` hinzugefügt).
- PDF-Export: Verbesserte Chromium-Erkennung auf macOS (inkl. Homebrew-Pfade) und detailliertere Logging-Informationen.
- Word-Export (DOCX): HTML-Parser komplett überarbeitet - verschachtelte Listen, Formatierungen (fett, kursiv, unterstrichen) und verschachtelte Strukturen werden jetzt korrekt übernommen statt als Fließtext dargestellt.

## [1.0.0] - 2025-02-12

### Added
- `ProcessStatusCard` als einheitliche Prozesskomponente mit Schrittanzeige, ETA und rotierenden Lade-Texten.
- Event-Timeline pro Transkriptionsjob über `transcription_events` in der Detailansicht.
- Auto-Weiterleitung nach Upload (optional), sobald Ergebnis bereit ist.
- Migrationsskript für Legacy-API-Keys: `npm run migrate-api-keys`.
- Umfassende technische und betriebliche Dokumentation (README, Projektplan, Docs-Konsolidierung).
- Serverseitiger PDF-Export-Endpunkt `POST /api/export/pdf` mit Auth, Rate-Limit und Chromium-Renderpipeline.
- Fester PDF-Standard für konsistente Markenanmutung: `Soft Business` + `Google Sans Soft` (mit Fallbacks).
- PDF-Typografie veredelt: bessere Heading-Hierarchie, weichere Tabellen, akzentuierte Listenmarker, sauberere Leseführung.
- Fokusmodus-Bezeichnungen auf klare UI-Sprache angepasst: `Hell` / `Dunkel`.
- Premium-PDF-Profil in den Einstellungen (`Unternehmen`, `Name`, `Rolle`, `Kontakt`, `Fußzeile`).
- Premium-Layout im PDF-Export pro Vorgang einzeln zuschaltbar (Editor-Schalter).
- SSE-Stream für Live-Status bei Transkriptionsjobs: `GET /api/transcriptions/[id]/stream`.
- DB-basierte Queue/Worker-Verarbeitung für Transkriptionsjobs (`queued`-Status + Worker-Pump).
- Zentrales Observability-Modul (`lib/observability.js`) mit strukturierter Log-Ausgabe und Laufzeit-Countern.
- Admin-Observability-Endpunkt: `GET /api/admin/observability`.

### Changed
- UI auf reduzierte, Apple-orientierte Interaktion ausgerichtet.
- `settings`-Updatepfad auf wartbaren dynamischen Query-Builder umgestellt.
- PDF-Export-Flow im Editor auf robustes Hybridmodell umgestellt.

### Fixed
- Robustere Job-Verarbeitung durch atomische Statusübergänge.
- ESLint-Warnungen vollständig bereinigt.

### Security
- Verschlüsselte API-Key-Speicherung.
- Rate-Limits auf kritischen API-Endpunkten.
