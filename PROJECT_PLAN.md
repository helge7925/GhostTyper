# GhostTyper Projektplan

Stand: 2026-02-19

## Aktuelle Version

**v1.2.0** - Organisation & Suche

---

## 1. Zielbild

GhostTyper ist eine sichere, selbstgehostete KI-Webapp für:
- Audio-Transkription (Mistral Voxtral)
- OCR (Mistral OCR)
- Textanalyse mit KI
- Tabellen-Extraktion
- Editor-zentrierte Nachbearbeitung (PDF/DOCX Export)
- **Volltext-Suche** über alle Transkripte (v1.2.0)
- **Vorlagen-Kategorien** für Organisation (v1.2.0)

---

## 2. Ist-Stack

| Bereich | Technologie |
|---------|-------------|
| Frontend | Next.js 13 (Pages Router), React 18, Tailwind |
| Backend | Next.js API Routes |
| Auth | NextAuth Credentials + JWT |
| Datenbank | PostgreSQL 16 |
| AI Models | Mistral Large/Medium/Small/Voxtral/OCR |
| Deployment | Docker Compose + Traefik |

---

## 3. Features nach Version

### v1.2.0 (Aktuell) - Organisation & Suche

#### Neue Funktionen
- **Volltext-Suche**:
  - Durchsucht Transkript-Inhalte, Analysen und Dateinamen
  - Server-Side mit PostgreSQL ILIKE
  - Debounced Live-Suche mit Loading-Indicator

- **Vorlagen-Kategorien**:
  - Selbst erstellbare Kategorien für Vorlagen
  - Farbige Badges für visuelle Unterscheidung
  - CRUD direkt in den Einstellungen

#### Technische Erweiterungen
- Neue DB-Tabelle: `template_categories`
- Neue DB-Spalte: `templates.category_id`
- Neue API-Endpunkte: `/api/template-categories/*`
- Erweiterte API: `GET /api/transcriptions?search=`

### v1.1.0 - Tabellen-Extraktion

#### Neue Funktionen
- **Tabellen-Vorlagen**: Extrahiere strukturierte Daten aus Text/Audio
  - Visueller Schema-Editor mit Drag & Drop
  - Datentypen: Text, Zahl, Währung, Datum
  - Berechnete Felder (Formeln: `menge * preis`)
  - Automatische Summen-Berechnung
  
- **Interaktive Tabellen-Ansicht**:
  - Inline-Editing von Extraktions-Ergebnissen
  - Zeilen hinzufügen/entfernen
  - Export: CSV, Excel (XLSX), HTML
  
- **KI-Schema-Generator**: Erstelle Tabellenschemas aus Beschreibungen

#### Technische Erweiterungen
- Neue DB-Spalten: `template_type`, `table_schema`, `analysis_type`
- Neue Module: `table-calculations.js`, `table-export.js`, `table-template-generator.js`
- Neue Komponenten: `TableSchemaBuilder`, `TableRenderer`
- Neue Dependency: `xlsx` für Excel-Export

### v1.0.1 - Bugfixes
- iOS Audio-Upload
- Editor Verbesserungen
- PDF/DOCX Export Fixes

### v1.0.0 - Erstrelease
- Alle Kernfunktionen (Audio, OCR, Analyse, Editor)
- Admin-System
- Queue/Worker-Verarbeitung
- Production-ready

---

## 4. Datenbank-Schema

### Templates Tabelle (Erweitert)
```sql
CREATE TABLE templates (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  name VARCHAR(100),
  prompt_text TEXT,
  template_type VARCHAR(20) DEFAULT 'text',  -- NEU: 'text' | 'table'
  table_schema JSONB,                         -- NEU: Schema-Definition
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### Transcriptions Tabelle (Erweitert)
```sql
CREATE TABLE transcriptions (
  id SERIAL PRIMARY KEY,
  -- ... bestehende Spalten ...
  analysis_type VARCHAR(20) DEFAULT 'text',   -- NEU: 'text' | 'table'
  table_schema JSONB,                         -- NEU: Referenz zum Schema
  -- ...
);
```

---

## 5. User Workflows

### Tabellen-Extraktion Workflow

1. **Vorlage erstellen**:
   ```
   Einstellungen → Verarbeitungstemplates → Tabellen-Verarbeitung
   → "+ Neue Tabellen-Vorlage"
   ```

2. **Schema definieren**:
   - Name eingeben (z.B. "Rechnungspositionen")
   - Spalten hinzufügen (Pos., Artikel, Menge, Preis)
   - Berechnungen definieren (Gesamt = Menge × Preis)

3. **Transkription durchführen**:
   - Audio hochladen
   - Tabellen-Vorlage auswählen
   - Verarbeitung starten

4. **Ergebnis bearbeiten**:
   - Extrahierte Daten als Tabelle anzeigen
   - Inline-Editing für Korrekturen
   - Export nach Excel/CSV

---

## 6. API Endpunkte

### Templates
```
GET    /api/templates           # Alle Vorlagen (inkl. table_schema)
POST   /api/templates           # Neue Vorlage (mit template_type)
PUT    /api/templates/:id       # Vorlage aktualisieren
DELETE /api/templates/:id       # Vorlage löschen
```

### Transcriptions
```
GET    /api/transcriptions/:id           # Details (inkl. analysis_type)
POST   /api/transcriptions/:id/analyze   # Analyse starten
GET    /api/transcriptions/:id/stream    # SSE Status-Updates
```

---

## 7. Komponenten-Architektur

### TableSchemaBuilder
```
┌─────────────────────────────────────┐
│  Vorlage: [Rechnungspositionen]     │
├─────────────────────────────────────┤
│  Typ: Manuell | Mit Beschreibung    │
├─────────────────────────────────────┤
│  SPALTEN                            │
│  ┌──────────┬──────────┬─────────┐  │
│  │ pos      │ artikel  │ menge   │  │
│  │ (number) │ (text)   │ (number)│  │
│  └──────────┴──────────┴─────────┘  │
│  [+ Spalte hinzufügen]              │
├─────────────────────────────────────┤
│  BERECHNUNGEN                       │
│  ┌──────────────────────────────┐   │
│  │ gesamt = menge * preis       │   │
│  │ [x] In Tabelle  [x] In Fußzeile│  │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

### TableRenderer
```
┌──────────────────────────────────────┐
│ Rechnungspositionen (5 Zeilen)  [Edit]│
├──────────────────────────────────────┤
│ Pos │ Artikel    │ Menge │ Preis  │ Gesamt│
├─────┼────────────┼───────┼────────┼───────┤
│  1  │ Artikel A  │   2   │ 10.00  │ 20.00 │
│  2  │ Artikel B  │   5   │  5.00  │ 25.00 │
├─────┴────────────┴───────┴────────┼───────┤
│                                    │ 45.00 │
├────────────────────────────────────┴───────┤
│ [CSV] [Excel] [Kopieren]                   │
└────────────────────────────────────────────┘
```

---

## 8. Nächste Schritte (v1.2.0+)

### Geplante Features
- [ ] **Template Library**: Vorlagen teilen/importieren
- [ ] **Batch Processing**: Mehrere Dateien gleichzeitig
- [ ] **API Webhooks**: Externe Integrationen
- [ ] **Advanced Analytics**: Nutzungsstatistiken
- [ ] **Multi-Language UI**: UI in mehreren Sprachen

### Technical Debt
- [ ] Redis für Queue statt DB-basiert
- [ ] E2E Tests mit Playwright
- [ ] OpenAPI Dokumentation

---

## 9. Betriebs-Shortlist

### Nach Update auf v1.1.0

1. **Container neu bauen**:
   ```bash
   docker compose -f config/docker-compose.dev.yml up --build -d
   ```

2. **Datenbank migrieren**:
   ```bash
   curl -X POST http://localhost:3000/api/db-init \
     -H "x-init-secret: dev-db-init-secret"
   ```

3. **Neue Dependency prüfen**:
   ```bash
   npm install  # xlsx wurde hinzugefügt
   ```

---

## 10. Dokumentation

- **Changelog**: Siehe `CHANGELOG.md`
- **Technische Details**: Siehe `Memory.md`
- **Deployment**: Siehe `docs/vps-deployment-guide.md`

---

## Kontakt

GhostTyper © 2026 Helge Roos
Private Project - All Rights Reserved
