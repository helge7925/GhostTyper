# Implementierungs-Update (2026-02-21)

## Umgesetzte Punkte

1. Realtime-Benennung
- `Team Realtime` wurde in UI-Texten auf `Echtzeitverarbeitung` umgestellt.

2. One-Klick-Workflows ausgelagert
- Neue Seite `pages/workflows.js` für dedizierte Workflow-Ausführung.
- Workflow-Block aus `pages/text-ai.js` entfernt.
- Quick-Workflow-Selector aus `components/AudioUploadForm.js` entfernt.
- Neue Startseite (`pages/index.js`) für authentifizierte Nutzer mit Workflow-Fokus und Dashboard-Karten.
- Navigationseintrag `1-Klick-Workflows` in der Sidebar ergänzt.

3. Wissensgraph als Standard-Template
- Neues Builtin `knowledge_graph` in Prompt- und Template-Auflösung:
  - `lib/prompts.js`
  - `lib/template-service.js`
  - `lib/ai-service.js`
  - `lib/constants.js`
- Auswahloptionen in Upload/OCR/Settings ergänzt.

4. Tabellen-Schema um Zeilen erweitert
- `components/TableSchemaBuilder.js` unterstützt jetzt:
  - separate Zeilen-Definitionen (`rows`)
  - Zeilen hinzufügen/entfernen/umsortieren
  - Pflicht-/Editierbar-/Hinweis-Felder pro Zeile
- `lib/table-calculations.js`:
  - Validierung für `rows`
  - Prompt-Aufbau mit `row_key` und vordefinierten Zeilen
- `lib/table-analysis.js`:
  - Validierung von `row_key`
  - Prüfung fehlender Pflicht-Zeilen
- `lib/table-template-generator.js`:
  - `rows: []` in generierten Schemas verankert

4b. Realtime mit Dokument-Vorlage
- Beim Erstellen von Realtime-Sessions kann jetzt die Dokument-Vorlage gewählt werden.
- Die Vorlage ist in der aktiven Session änderbar (für Owner/Editor).
- Auswahl unterstützt Standard-Vorlagen und eigene Text-Vorlagen.
- Die ausgewählte Vorlage wird persistiert (`realtime_sessions.document_template`) und steuert:
  - die Live-Dokumentstruktur
  - die finale Realtime-KI-Dokumenterstellung

5. Export-Kopfbereich entfernt
- UI-Toggle und related Settings aus dem Editor/Settings entfernt.
- PDF-API rendert ohne Premium-Kopfbereich.
- Premium-Header-Markup/CSS aus Export-Stack entfernt.
- Verbleibende `pdfPremium*`-Felder aus `pages/api/settings.js` entfernt.
- Verbleibende `pdf_premium_*`-Schema-Definitionen aus `lib/db-init.js` entfernt.

## Regression-Tests

Zusätzliche Tests:
- `tests/constants.test.mjs` (`normalizeDefaultTemplate`, inkl. `knowledge_graph`)
- `tests/prompts.test.mjs` (`getPrompt('knowledge_graph')`)
- Erweiterte Table-Tests in `tests/table-calculations.test.mjs` (Zeilen-Keys + `row_key`-Prompt)

Ausgeführte Checks:
- `npm test` ✅
- `npm run lint` ✅
- `npm run build` ✅
- `npm run smoke` ✅
- `npm run smoke:full` ✅ (inkl. PDF-Render-Check)
