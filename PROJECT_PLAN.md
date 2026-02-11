# GhostTyper Projektplan

Stand: 2026-02-11

## 1. Zielbild

GhostTyper ist eine sichere, selbstgehostete KI-Webanwendung für Audio, OCR, Übersetzung und Textverarbeitung mit einem editor-zentrierten Nutzerfluss:
- Aufnahme/Upload -> Transkription/OCR -> Analyse -> Bearbeitung im Editor -> Export.

Qualitätsziele:
- Keine Funktionsverschlechterung bei Sicherheitsmaßnahmen.
- Hohe Transparenz im Verarbeitungsstatus.
- Konsistentes UX-Verhalten auf Desktop und Mobile.

## 2. Architektur (Ist)

| Bereich | Technologie |
|---|---|
| Frontend | Next.js 13 (Pages Router), React 18, Tailwind |
| Backend | Next.js API Routes |
| Auth | NextAuth Credentials + JWT |
| Datenbank | PostgreSQL 16 |
| KI-Transkription | Mistral Voxtral (`voxtral-mini-latest`) |
| KI-Analyse/Translate | Mistral Large/Medium/Small |
| OCR | Mistral OCR |
| Deployment | Docker Compose, Traefik |

## 3. Umgesetzte Arbeitspakete

### AP-01 Kernfunktionen
Status: abgeschlossen
- Audio-Upload, Browser-Aufnahme, Transkription
- OCR Upload/Kamera
- Analyse-Templates inkl. Custom Prompt
- Übersetzungsmodul
- Document Editor mit PDF/DOCX Export

### AP-02 Benutzer/Administration
Status: abgeschlossen
- Login/Auth
- Admin-Userverwaltung
- Kosten-Tracking und Monatslimit
- Profilverwaltung

### AP-03 Security Hardening
Status: abgeschlossen
- API-Key-Verschlüsselung in `settings.mistral_api_key_encrypted`
- Migrationsskript für Legacy-Klartext-Keys (`scripts/migrate-api-keys.js`)
- Rate-Limits für kritische Routen
- Modell-Whitelist (serverseitige Validierung)
- getrennte Secrets für DB-Init (`DB_INIT_SECRET`)
- Produktionsschutz für `/api/db-init` über `ENABLE_DB_INIT_API`
- robustes Error-Handling und reduzierte sensible Logs

### AP-04 Stabilität & Betriebsrisiken
Status: abgeschlossen
- atomische Statusübergänge (`pending -> processing`, `transcribed -> analyzing`)
- Schutz vor Doppelstarts (409)
- Stale-Job-Recovery bei hängenden Jobs
- sichere Dateilöschung nur unterhalb `uploads/`
- Upload/OCR-Tempfile-Cleanup verbessert

### AP-05 UX-/Produktverbesserungen
Status: abgeschlossen
- einheitliche Prozessanzeige (`ProcessStatusCard`)
- ETA/Restzeit + rotierende Lade-Texte
- Auto-Weiterleitung nach Upload (optional)
- Event-Timeline je Auftrag (`transcription_events`)
- Detailseite auf Editor-Workflow fokussiert (Translation dort entfernt)
- Live-Status für laufende Transkriptionsjobs via SSE mit Polling-Fallback
- Microcopy-Überarbeitung auf Kernseiten (reduzierter, konsistenter Ton)

### AP-06 Datenbank-/Migrationspflege
Status: abgeschlossen
- neue DB-Spalten/Tables über `lib/db-init.js`
- `transcription_events` Tabelle + Indizes
- `mistral_api_key_encrypted` Spalte + Migrationspfad

### AP-07 PDF-Export-Härtung (Startphase)
Status: in Umsetzung (MVP+ erweitert)
- neuer API-Exportpfad `POST /api/export/pdf`
- serverseitiges Rendering über Chromium (Docker vorbereitet)
- Editor nutzt API-Export mit Fallback auf Browser-Print
- fester PDF-Markenstil für Konsistenz (`Soft Business` + `Google Sans Soft`)
- PDF öffnet standardmäßig direkt im Browser (inline)
- Premium-Layout pro Export im Editor einzeln zuschaltbar
- Premium-Metadaten in Einstellungen hinterlegbar und serverseitig in PDF-Kopf integriert
- Optionaler schlanker PDF-Kopfbereich (Titel, Datum, Projekt) integriert

## 4. Betriebsschritte nach Migration

1. Container neu bauen/starten:
```bash
docker compose -f config/docker-compose.dev.yml up --build -d
```

2. DB-Init/Migrationen anwenden:
```bash
curl -X POST http://localhost:3000/api/db-init -H "x-init-secret: dev-db-init-secret"
```

3. Legacy API Keys migrieren:
```bash
export SETTINGS_ENCRYPTION_KEY='dev-settings-encryption-key'
export DATABASE_URL='postgresql://transkription:transkription@localhost:5432/transkription'
npm run migrate-api-keys -- --dry-run
npm run migrate-api-keys
```

4. Verifizieren:
```bash
docker compose -f config/docker-compose.dev.yml exec transkription-db \
  psql -U transkription -d transkription -c "SELECT COUNT(*) AS plaintext_remaining FROM settings WHERE NULLIF(TRIM(mistral_api_key), '') IS NOT NULL;"
```

## 5. Qualitätsstatus

- Funktionsumfang: intakt, um sicherheitsrelevante Schutzmechanismen erweitert.
- UX: deutlich transparenter bei längeren Jobs (Status, ETA, Verlauf).
- Build: Kompilierung erfolgreich; Sandbox-Fehler `EPERM listen 0.0.0.0` kann in restriktiven Umgebungen auftreten.

## 6. Offene Roadmap (nächste Schritte)

### P1 (hoch)
- End-to-End Regressionstest-Matrix formalisieren (Audio, OCR, Translate, Editor-Export).
- ESLint-Konfiguration fixieren, damit `npm run lint` non-interaktiv in CI läuft.

### P2 (mittel)
- Queue/Worker-Entkopplung für Hintergrundjobs (z. B. Redis/BullMQ).
- Zentralisiertes Observability-Setup (strukturierte Logs, Job-Metriken).

### P3 (mittel)
- Feinjustierung PDF-Paginierung (Witwen/Waisen, Heading-Umbruchschutz) auf Basis des neuen Renderer-Pfads.
- Weitere Mikro-UX-Verbesserungen im Apple-Stil (reduzierte Komplexität, klare Primäraktionen).

## 7. Umsetzungsplan PDF-Renderer (stabiler Export)

Ziel:
- Umstellung vom Browser-Print (`window.print`) auf serverseitigen PDF-Render, um konstante, reproduzierbare PDF-Ausgaben für Standard- und Spezial-Templates (z. B. Aufmaß) zu erreichen.

Arbeitspakete:
1. Technische Basis
- Status: erledigt
- API-Route `POST /api/export/pdf` implementiert.
- Renderer auf Chromium-CLI ausgelegt (`PDF_CHROMIUM_PATH`).
2. Print-Template
- Status: erledigt (Basis)
- Dedizierte A4-Print-CSS im Server-Renderer.
- Umbruchschutz für Überschriften, Tabellen und typische Blocks integriert.
3. Backend-Exportpipeline
- Status: erledigt (Basis)
- Request-Validierung, Sanitizing, Timeout-Handling und Tempfile-Cleanup vorhanden.
4. Frontend-Integration
- Status: erledigt (Basis)
- PDF-Button nutzt API-Export und fällt bei Fehlern auf Browser-Print zurück.
5. Betriebsstabilität
- Status: teilweise offen
- Docker-Abhängigkeiten ergänzt (Chromium + Fonts).
- Feintuning für parallele Exportjobs/Lastgrenzen noch offen.
6. Qualitätssicherung
- Status: offen
- Gezielte Vergleichstests für lange Spezial-Templates (Aufmaß, Mehrseiten-Tabellen) ausstehend.

Zeitabschätzung (eigener Aufwand):
- MVP (API + UI + Basislayout): 1,5 bis 2 Arbeitstage.
- Produktionsreife Umsetzung inkl. Stabilität für Spezial-Templates, Limits, QA und Doku: gesamt 3 bis 5 Arbeitstage.
- Puffer für Feinschliff bei komplexen Umbruchfällen: +0,5 bis 1 Arbeitstag.
- Realistische Gesamtschätzung: 4 bis 6 Arbeitstage.

Risiken:
- Zusätzlicher Ressourcenbedarf (Chromium in Container, RAM-Spitzen bei Exportjobs).
- Unterschiedliche Inhaltsqualität alter Dokumente (unsaubere HTML-Strukturen) kann Einzelfall-Nacharbeit erzeugen.

Erfolgskriterien:
- Keine Browser-Header/Footer-Artefakte mehr im Export.
- Konsistente Seitenumbrüche ohne abgeschnittene Zeilen.
- Reproduzierbare PDF-Ausgabe über Desktop/Mobile-Clients hinweg.

## 8. Referenzen

- Hauptdoku: `docs/README.md`
- Features: `docs/features-and-improvements.md`
- Security/Hardening: `docs/code-review-hardening-2026-02-11.md`
