# Datentabelle Rollout (2026-03-08)

Stand: 2026-04-28

## Ziel

Einführung einer separaten Funktion **Datentabelle** (ähnlich NotebookLM), die aus:
- Audio
- Text
- OCR (PDF/Bild)

strukturierte Tabellen extrahiert und in der bestehenden Tabellen-UI anzeigt.

## Umgesetzter Umfang

### 1. Neuer Wissensaufbereitungsmodus
- Neuer Modus `data_table` in der Knowledge-Prep-Workspace-Logik.
- Neue dedizierte Seite: `/datentabelle`.
- Neuer Sidebar-Navigationseintrag: **Datentabelle**.

### 2. Prompt- und Template-Integration
- Neues Built-in Prompt-Profil `data_table` (DE/EN).
- Template-Resolver akzeptiert jetzt `data_table` als Built-in.
- Analyse-Pipeline (`ai-service`) behandelt `data_table` analog zu anderen Built-ins.

### 3. Normalisierung für robuste Tabellenausgabe
- Neues Modul `lib/data-table.js` normalisiert LLM-Ausgaben zu:
  - `rows`
  - `table_schema` (dynamische Spalten inkl. Typ-Inferenz)
  - `analysis_meta` (u. a. Zeilenanzahl, Zusammenfassung, Missing-Hinweise)
- Ziel: auch bei heterogenem Modelloutput stabiles Rendering in `TableRenderer`.

### 4. End-to-End für alle drei Quellen

- Audio:
  - Worker-Flow unterstützt `data_table` und persistiert als `analysis_type='table'`.
  - Manuelle Analyse unterstützt `data_table` ebenfalls.

- Text:
  - `/api/knowledge-prep/text` akzeptiert `template='data_table'`.
  - Persistenz als Tabellenanalyse (`analysis_type`, `analysis_meta`, `table_schema`).

- OCR:
  - `/api/ocr` unterstützt `template='data_table'` bei aktivierter Analyse.
  - Persistenz ebenfalls als Tabellenanalyse.

### 5. UI-Konsistenz
- Historie-Karten zeigen `Datentabelle` als Template-Label.
- Detailansicht zeigt bei diesem Template Titel/Badge passend als Datentabelle.

### 6. Dashboard API-Status
- Dashboard zeigt den Mistral-API-Status.

## Wichtige Dateien

- UI/Navigation:
  - `pages/datentabelle.js`
  - `components/KnowledgePrepWorkspace.js`
  - `components/Sidebar.js`
  - `components/TranscriptionCard.js`
  - `pages/transcriptions/[id].js`
  - `pages/index.js`

- Prompt/Template/Analyse:
  - `lib/prompts.js`
  - `lib/template-service.js`
  - `lib/ai-service.js`
  - `lib/data-table.js`
  - `lib/transcription-worker.js`
  - `lib/manual-analysis.js`

- API:
  - `pages/api/knowledge-prep/text.js`
  - `pages/api/ocr.js`

## Verifikation

### Lint/Tests
- ESLint auf allen betroffenen Dateien: erfolgreich.
- Testlauf: `npm test -- tests/prompts.test.mjs` erfolgreich.

### Container Rebuild (Dev)
Ausgeführt am 2026-03-08:

```bash
docker compose -f config/docker-compose.dev.yml up -d --build
```

Ergebnis:
- Image `transkription-webapp:dev` neu gebaut.
- Container `transkription-webapp` neu erstellt und gestartet.
- `next build` im Image erfolgreich.

Statusprüfung:

```bash
docker compose -f config/docker-compose.dev.yml ps
curl -sS -i http://localhost:3000/api/health
```

Resultat:
- `transkription-webapp`: **healthy**
- `transkription-db`: **healthy**
- Health-Endpunkt: `HTTP/1.1 200 OK`

## Update 2026-04-28: Content-only Tabellen-Vorlagen

Die Datentabellen-Funktion wurde um einen praxisnäheren Vorlagenfluss erweitert:

- Tabellen-Vorlagen definieren jetzt Metadatenfelder, feste Zeilentitel und Spaltentitel.
- Das KI-Modell füllt ausschließlich Inhalte in diese Felder.
- Berechnungen, Formeln, Summen und abgeleitete Werte sind im neuen Vorlagenfluss nicht vorgesehen.
- Der Vorlagen-Editor in den Einstellungen wurde als Excel-artiger Rastereditor umgesetzt.
- Befüllte Tabellen können in der Transkriptionsdetailansicht in einem Canvas-artigen Tabelleneditor nachbearbeitet und gespeichert werden.
- Der Excel-Export erzeugt eine saubere XLSX-Datei mit Metadaten oberhalb der Tabelle, formatierter Kopfzeile, Zeilentiteln und Schutz vor Formel-Injection.

Ergänzende Dokumente:
- Technische Tabellen-Dokumentation: `TABLE_TEMPLATES.md`
- Konzept Foto-zu-Tabellenvorlage: `konzept-automatische-tabellengenerierung-aus-foto.md`

Verifikation am 2026-04-28:
- `npm test`
- `npm run lint`
- `npm run build`
- `npm run smoke`
