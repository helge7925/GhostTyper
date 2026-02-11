# Audio Upload und Transkriptionsflow

Stand: 2026-02-11

Dieses Dokument beschreibt den Upload- und Verarbeitungsablauf für Audio in GhostTyper.

## 1. Unterstützte Eingaben

- Dateiupload (mehrere gängige Audio-Container)
- Browser-Aufnahme (Desktop/Mobile)

Wichtige Limits:
- Maximalgröße: `50 MB`
- MIME-/Extension-Prüfung serverseitig

## 2. API-Endpunkte

- `POST /api/upload`
  - validiert Datei
  - legt Transkriptionsjob in `pending` an
  - schreibt initiales Event `queued`
- `POST /api/transcriptions/:id/process`
  - startet Transkription (atomar)
- `POST /api/transcriptions/:id/analyze`
  - startet manuelle Analyse aus `transcribed`
- `GET /api/transcriptions/:id`
  - liefert Live-Status + Timeline (`events`)

## 3. Statusmodell

`pending` -> `processing` -> `transcribed` -> `analyzing` -> `completed`

Fehlerpfad:
- jeder Schritt kann zu `error` führen
- stale Jobs werden automatisch auf `error` gesetzt

## 4. UI-Flow

### 4.1 Upload-Seite
- Upload über `AudioUploadForm`
- nach Erfolg startet Hintergrundverarbeitung
- Anzeige über `ProcessStatusCard`:
  - Steps
  - ETA
  - rotierende Lade-Texte
- optional Auto-Weiterleitung zur Detailseite bei fertigem Ergebnis

### 4.2 Detailseite
- Live-Statusanzeige
- Verlauf (Timeline) aus `transcription_events`
- bei `transcribed` ggf. Sprecherzuweisung
- Übergang in den Editor für finalen Workflow

## 5. Sicherheits- und Stabilitätsmaßnahmen

- Rate-Limits auf Upload und Process/Analyze-Routen
- atomische Statuswechsel verhindern Doppelstarts
- sichere Pfadprüfung beim Löschen
- temporäre Dateien werden bei Fehlern bereinigt

## 6. Fehlerdiagnose (Kurz)

### 6.1 Upload wird abgelehnt
- Dateityp prüfen
- Dateigröße prüfen
- Serverantwort (`400`/`413`) prüfen

### 6.2 Job hängt lange in `processing`/`analyzing`
- Stale-Recovery setzt Jobs nach Timeout auf `error`
- Detailseite neu laden und Fehlertext prüfen

### 6.3 Keine KI-Auswertung
- API-Key-Konfiguration prüfen (`settings` oder ENV)
- Monatskostenlimit prüfen
- Modellkonfiguration prüfen

## 7. Referenzen

- Featureübersicht: `features-and-improvements.md`
- Implementierung: `implementation.md`
- Security-Hardening: `code-review-hardening-2026-02-11.md`
