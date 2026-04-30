# Changelog

Alle relevanten Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased] - Ziel: v1.3.0

### Added
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
