# Testen und Verifizieren

Stand: 2026-02-11

Dieses Dokument beschreibt die aktuelle Teststrategie für GhostTyper.

## 1. Testziele

- Funktionssicherheit der Hauptworkflows
- keine Regression durch Security-/Migrationsänderungen
- konsistentes Verhalten auf Desktop und Mobile
- Grundsicherheit der API-Routen (Auth, Rate-Limits, Validierung)

## 2. Teststufen

### 2.1 Smoke Tests (nach jedem größeren Change)
1. Login funktioniert.
2. Audio-Upload startet Verarbeitung.
3. Transkriptionsdetail lädt und zeigt Status.
4. OCR Upload funktioniert.
5. Übersetzung funktioniert.
6. Editor öffnet, speichert, exportiert.
7. Bei Startfehlern im Upload wird eine klare Fehlermeldung angezeigt.
8. `Erneut starten` (Upload) und `Verarbeitung starten` (Detailseite) funktionieren.

### 2.2 Funktions-Regression

#### A) Audio-Flow
- Upload gängiger Formate (`mp3`, `wav`, `webm`, `m4a`)
- Statuswechsel: `pending -> processing -> transcribed/analyzing -> completed`
- Diarisierung: Sprecherzuweisung + manuelle Analyse
- Event-Timeline vorhanden und plausibel
- Live-Status über SSE aktiv (kein sichtbares 3s-„Stottern“); Polling nur Fallback

#### B) OCR-Flow
- PDF und Bilddatei
- optional Analyse aktiv/inaktiv
- Ergebnis in Historie gespeichert

#### C) Übersetzung/Text-AI
- Eingabetext -> Ergebnis
- Editor-Übergabe und Speichern

#### D) Historie
- Filtern/Suchen
- Favorit/Ordner
- Löschen inklusive Datei-Cleanup

### 2.3 Sicherheits- und Betriebschecks
- Rate-Limits liefern bei Last erwartbar `429`
- Ungültige Modelle werden serverseitig abgewiesen (`400`)
- DB-Init nur mit korrektem Secret
- API-Key-Migration: keine Klartext-Keys verbleiben

## 3. Testumgebung

### 3.1 Lokal (Docker)
```bash
docker compose -f config/docker-compose.dev.yml up --build -d
curl -X POST http://localhost:3000/api/db-init -H "x-init-secret: dev-db-init-secret"
```

### 3.2 Optional: Legacy-Key Migration testen
```bash
export SETTINGS_ENCRYPTION_KEY='dev-settings-encryption-key'
export DATABASE_URL='postgresql://transkription:transkription@localhost:5432/transkription'
npm run migrate-api-keys -- --dry-run
npm run migrate-api-keys
```

## 4. Build-/Lint-Validierung

### 4.1 Build
```bash
npm run build
```
Hinweis: In restriktiven Sandbox-Umgebungen kann `EPERM listen 0.0.0.0` bei `Collecting page data` auftreten.

### 4.2 Lint
```bash
npm run lint
```
Aktueller Stand: es erscheint ein interaktiver ESLint-Setup-Dialog, solange keine finalisierte ESLint-Konfiguration vorliegt.

## 5. Mobile/Responsive Testkriterien

- Upload/OCR/Translate auf kleinen Viewports bedienbar
- keine horizontalen Overflow-Probleme in Kernansichten
- Statuskarten und Timeline bleiben lesbar
- Kamera-Upload im OCR-Flow auf Mobilgeräten nutzbar

## 6. Abnahme-Checkliste (Kurz)

1. Audio-Upload + Transkription + Analyse erfolgreich
2. OCR + Analyse erfolgreich
3. Editor speichern/exportieren erfolgreich
4. Event-Verlauf sichtbar
5. API-Key-Migration validiert (falls relevant)
6. Keine Klartext-API-Keys mehr in `settings.mistral_api_key`
7. Startfehler bei `pending` sind sichtbar und manuell behebbar (UI-Buttons vorhanden)

## 7. Referenzen

- `../README.md`
- `../PROJECT_PLAN.md`
- `code-review-hardening-2026-02-11.md`
- `features-and-improvements.md`
