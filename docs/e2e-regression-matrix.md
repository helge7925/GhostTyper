# E2E-Regressionsmatrix (Kernflows)

Stand: 2026-02-12

Diese Matrix formalisiert die manuellen End-to-End-Regressionstests für die produktkritischen Nutzerflüsse.

## Voraussetzungen

- App läuft lokal via Docker (`config/docker-compose.dev.yml`).
- `POST /api/db-init` wurde erfolgreich ausgeführt.
- Mindestens ein Testkonto mit gültigem API-Key ist vorhanden.

## Matrix

| ID | Bereich | Szenario | Erwartetes Ergebnis |
|---|---|---|---|
| E2E-AUD-01 | Audio | Audio-Upload (ohne Diarisierung, mit Auto-Analyse) | Statusfolge `pending -> processing -> analyzing -> completed`, Ergebnis im Editor sichtbar |
| E2E-AUD-02 | Audio | Audio-Upload mit Diarisierung | Status endet auf `transcribed`, Sprecherzuweisung möglich, manuelle Analyse startet zu `analyzing` |
| E2E-AUD-03 | Audio | Startfehler (z. B. API-Key entfernen) | Klare Fehlermeldung in UI, Job wechselt auf `error`, Neustart-Button sichtbar |
| E2E-OCR-01 | OCR | PDF/Bild hochladen ohne Analyse | OCR-Text wird gespeichert, Historieneintrag `completed`, Text im Detail abrufbar |
| E2E-OCR-02 | OCR | OCR mit anschließender Analyse | OCR + Analyse erfolgreich, strukturierte Analyse im Editor verfügbar |
| E2E-TXT-01 | Text-AI | Text-Assistent-Aufgabe auf langen Text anwenden | Ergebnis wird ohne 5xx zurückgegeben, Nutzung wird protokolliert |
| E2E-TRN-01 | Übersetzung | HTML/Text im Editor übersetzen | Übersetzter Inhalt wird im Editor übernommen, keine ungesäuberten Skripteinträge |
| E2E-EDT-01 | Editor | Bearbeiten + Speichern (`PATCH /transcriptions/:id`) | Speicherung erfolgreich, Reload zeigt persistierten Stand |
| E2E-EXP-01 | Export | PDF-Export serverseitig (`/api/export/pdf`) | PDF öffnet inline im Browser, Layout konsistent, keine Browser-Header/Footer |
| E2E-EXP-02 | Export | DOCX-Export | Download/Erzeugung erfolgreich, Inhalt entspricht Editorstand |
| E2E-EXP-03 | Export | Sehr langes Dokument (mehrseitig, Tabellen, Aufmaß-Blöcke) | Keine abgeschnittenen Zeilen, stabile Umbrüche, keine Browser-Header/Footer |
| E2E-EXP-04 | Export | Mehrere parallele PDF-Exporte (mind. 3 gleichzeitig) | Export bleibt stabil; bei Lastspitze klare `503`-Antwort mit Retry-Hinweis statt Crash |
| E2E-LIVE-01 | Live-Status | Laufenden Job in Detailseite verfolgen | SSE liefert Status-Updates; bei SSE-Fehler Polling-Fallback aktiv |
| E2E-SEC-01 | Security | Überlange `save-doc` Payload senden | API antwortet mit `400`, keine Speicherung, DB bleibt konsistent |
| E2E-SEC-02 | Security | Admin-User-Update inkl. Settings | User- und Settings-Änderung atomar (kein Teilzustand bei Fehler) |

## Abnahmekriterien

- Alle P0/P1-Schlüsselszenarien (`E2E-AUD-01`, `E2E-AUD-03`, `E2E-EXP-01`, `E2E-EXP-03`, `E2E-EXP-04`, `E2E-SEC-01`, `E2E-SEC-02`) sind grün.
- Kein unerwarteter Wechsel in `error` bei Happy-Path-Szenarien.
- Keine Regression bei Kernstatusübergängen (`pending`, `processing`, `analyzing`, `completed`, `error`).
