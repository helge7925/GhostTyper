# Sketch Summary Rollout (2026-03-08)

Stand: 2026-03-08

Dieses Dokument beschreibt den aktuellen Stand der Infografik-/Lernskizzen-Funktion (`/sketch`) nach Umstellung auf eine mehrstufige Pipeline.

## 1) Scope

- Seite: `/sketch` (auch alias `/infografik`)
- API: `POST /api/sketch-summary`
- Studio-Eingaben vor Generierung:
  - Layout (`auto`, `timeline`, `process_flow`, `comparison`, `mindmap`, `topic_tree`)
  - Detailgrad (`compact`, `standard`, `detailed`)
  - Illustrationsstil (`editorial`, `technical`, `minimal`)
  - Fokus (Freitext)
- Ausgabe: vektorbasiertes SVG (`image/svg+xml`) im Querformat

## 2) Pipeline (3 Schritte)

Implementierung:
- `pages/api/sketch-summary.js`
- `lib/infographic-engine.js`

Ablauf:
1. **Semantik-Extraktion (LLM)**
   - Modell erzeugt Struktur-JSON (`title`, `layout`, `blocks`, `links`)
   - Prompt wird mit Layout/Detail/Fokus angereichert.
2. **Illustrationsplanung (LLM)**
   - Modell weist pro Block thematisch passende Illustration zu (`icon`, `scene`, `motif`).
3. **Deterministisches Rendering (lokal)**
   - Einheitliche Layout-Engine rendert SVG mit:
     - typografischen Regeln,
     - Safe-Margins,
     - konsistenten Abständen,
     - Verbindungen und thematischen Block-Illustrationen.

Fallback-Verhalten:
- Bei fehlendem Google-Key, Quota, unvollständiger Modellantwort oder Parsing-Problemen wird lokal eine heuristische Struktur + lokale Illustrationszuordnung verwendet.
- Dadurch bleibt die Funktion robust und liefert weiterhin ein konsistentes Ergebnis.

## 3) API-Verhalten (`/api/sketch-summary`)

Request:
```json
{
  "text": "...",
  "layoutMode": "auto|timeline|process_flow|comparison|mindmap|topic_tree",
  "detailLevel": "compact|standard|detailed",
  "illustrationStyle": "editorial|technical|minimal",
  "focus": "optionaler Fokus"
}
```

Response (200):
```json
{
  "imageBase64": "PHN2ZyB4bWxucz0iLi4u",
  "mimeType": "image/svg+xml",
  "fallback": false,
  "notice": "",
  "layout": "timeline",
  "illustrationStyle": "editorial",
  "blocks": 10,
  "illustrations": 10
}
```

Fehler:
- `400`: Text fehlt/zu lang oder Fokus zu lang
- `401`: Nicht authentifiziert
- `429`: Kostenlimit erreicht
- `503`: Kostenprüfung temporär nicht verfügbar

Hinweise:
- Provider-/Quota-/Berechtigungsprobleme führen bewusst zu lokalem Fallback mit `200` + `fallback: true`.
- Rate-Limit: 20 Requests / Minute / User.

## 4) Layout/Qualität

- Fester Canvas: `1920x1080` (Querformat)
- Safe-Margins gegen abgeschnittene Elemente
- Unterstützte Layouttypen:
  - Timeline
  - Process Flow
  - Comparison
  - Mindmap
  - Topic Tree
- Thematische Piktogramme pro Block (`idea`, `chart`, `timeline`, `people`, `warning`, ...)
- Thematische Szenen pro Block (`process`, `data`, `network`, `timeline`, `education`, `research`, `finance`, `healthcare`, `legal`, `communication`, `environment`, `technology`, `risk`, `decision`, `people`, `comparison`)

## 5) Realtime UI Fix (zusätzliche Änderung)

- `pages/realtime.js`: Session-Startbereich responsiv gehärtet.
- Start-Button bleibt auf kleinen Screens innerhalb der Container-Box.

## 6) Verifikation

Ausgeführte Checks:
- `npx eslint lib/infographic-engine.js pages/api/sketch-summary.js pages/sketch.js pages/realtime.js`
- Ergebnis: erfolgreich

Container-Rebuild (Dev):
```bash
docker compose -f config/docker-compose.dev.yml up -d --build
```

Statusprüfung:
```bash
docker compose -f config/docker-compose.dev.yml ps
curl -sS -i http://localhost:3000/api/health
```

Resultat:
- `transkription-webapp`: healthy
- `transkription-db`: healthy
- Health-Endpunkt: `HTTP/1.1 200 OK`
