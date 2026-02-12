# Externes Code-Review (Kollegenreview) - 2026-02-12

Stand: 2026-02-12  
Quelle: externes Review durch Kollegen (nicht internes Hardening-Review).

Dieses Dokument bildet die Inhalte des externen Reviews nach, damit sie im Projekt nachvollziehbar abgelegt sind.

## 1) Gesamtfazit des externen Reviews

- Gute, produktionsreife Next.js-Codebasis mit klarer Separation of Concerns.
- Sicherheitsgrundlagen vorhanden (parametrisierte Queries, Hashing, Verschlüsselung, Rate-Limits).
- Haupt-Risikofelder: Editor-XSS-Randfall, fehlende Input-Grenzen, Duplikate/Wartbarkeit, fehlende Queue-Entkopplung.

## 2) Positiv hervorgehobene Punkte

- Konsistente API-Patterns (Auth, Rate-Limit, Validierung, Fehlerbehandlung).
- Solide Sicherheitsbasis (bcrypt, AES-GCM, Modell-Whitelist, Path-Schutz).
- Gute DB-Grundlagen (FKs, Indizes, idempotente Migrationen).
- Solider Deployment-Stack (Docker Multi-Stage, Traefik, Persistenz).

## 3) Kritische Befunde (aus dem externen Review)

### Sicherheit/Stabilität
- Editor-XSS-Risiko bei laufenden `contentEditable`-Edits.
- Keine Längenlimits für `save-doc` (`title`, `text`, `documentHtml`).
- Verschlüsselungskey-Fallback auf `NEXTAUTH_SECRET` problematisch.
- Input-Validierung für `action` in `text-ai` formal unvollständig.

### Wartbarkeit/Architektur
- Duplikate in Placeholder-/Sanitizing-Logik.
- Duplikate in Stale-Job-Recovery.
- Sehr große Settings-Upsert-Query (lesbar/wartbar schwierig).
- User/Settings-Update ohne Transaktion (Inkonsistenzrisiko).

### Skalierung/Betrieb
- Hintergrundverarbeitung im Request-Kontext statt Queue/Worker.
- In-Memory-Rate-Limit nur Single-Instance-robust.
- Fehlende strukturierte Logging-/Metrik-Basis.

### Frontend/UX
- `document.execCommand` als veraltete API.
- Fehlende/verbesserbare Zustandskommunikation in einzelnen Flows.

## 4) Priorisierung aus dem externen Review (intern auf P0-P3 abgebildet)

- **P0 (kritisch)**: akute Sicherheits-/Stabilitätsrisiken.
- **P1 (hoch)**: Wartbarkeit/Konsistenz in Kernpfaden.
- **P2 (mittel)**: Queue/Worker + Observability-Basis.
- **P3 (mittel)**: Ausgabequalität (PDF) + Mikro-UX-Verfeinerung.

Umsetzungsstatus und konkrete Änderungen:  
`code-review-priorities-p0-p3-2026-02-12.md`
