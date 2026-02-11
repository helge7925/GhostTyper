# Dokumentationsrichtlinie

Stand: 2026-02-11

Dieses Dokument beschreibt, wie die Projekt-Dokumentation in GhostTyper strukturiert, gepflegt und versioniert wird.

## 1. Ziel

Die Dokumentation soll:
- den aktuellen Ist-Zustand abbilden,
- Betrieb und Weiterentwicklung beschleunigen,
- Sicherheits- und Migrationsänderungen nachvollziehbar machen,
- ohne implizites Teamwissen verständlich sein.

## 2. Struktur

Zentrale Einstiegspunkte:
- `../README.md`: Produktüberblick, Quickstart, Migration
- `../PROJECT_PLAN.md`: aktueller Projektplan und Roadmap
- `README.md`: Navigationsseite für `docs/`

Fachdokumente:
- `features-and-improvements.md`: Funktionsstand und UX-Verbesserungen
- `implementation.md`: technische Architektur und Implementierungsdetails
- `code-review-hardening-2026-02-11.md`: Security-Review, Maßnahmen, Checklisten
- `api-specification.md`: API-Verträge
- `testing.md`: Teststrategie
- `docker-setup.md`, `vps-deployment-guide.md`: Betrieb/Deployment

## 3. Pflegeprozess

Bei jeder relevanten Änderung müssen mindestens folgende Dateien geprüft werden:
- Feature-/UX-Änderung:
  - `README.md`
  - `docs/features-and-improvements.md`
  - ggf. `PROJECT_PLAN.md`
- Security-/Migrations-Änderung:
  - `docs/code-review-hardening-2026-02-11.md`
  - `README.md` (Betriebsbefehle)
  - `PROJECT_PLAN.md`
- API-Änderung:
  - `docs/api-specification.md`
- Betriebs-/Deployment-Änderung:
  - `docs/docker-setup.md` und/oder `docs/vps-deployment-guide.md`

## 4. Qualitätskriterien für Doku

Jede aktualisierte Doku soll:
- ein `Stand: YYYY-MM-DD` enthalten,
- konkrete Befehle statt Platzhalter enthalten,
- klare Voraussetzungen nennen (ENV, Dienste, Datenbank),
- den Unterschied zwischen Dev und Prod klar machen,
- auf Folgeprüfungen verweisen (Verifikation nach Migration).

## 5. Redaktionsregeln

- Keine generischen Datei-Anlege-/Editier-Platzhalter aus Initial-Tutorials.
- Keine veralteten Workflows ohne Kennzeichnung.
- Keine widersprüchlichen Secrets/Namen zwischen README und Setup-Dokumenten.
- Statusbegriffe konsistent halten (`pending`, `processing`, `transcribed`, `analyzing`, `completed`, `error`).

## 6. Pflicht-Check vor Merge/Release

1. Sind `README.md` und `PROJECT_PLAN.md` auf aktuellem Stand?
2. Sind neue ENV-Variablen in `.env.example` dokumentiert?
3. Sind Migrationsschritte inkl. Verifikation dokumentiert?
4. Stimmen API-Parameter und Antworten mit `docs/api-specification.md` überein?
5. Gibt es tote/veraltete Dokuabschnitte oder widersprüchliche Befehle?

## 7. Referenzen

- Einstieg: `README.md`
- Plan: `../PROJECT_PLAN.md`
- Security: `code-review-hardening-2026-02-11.md`
- Features: `features-and-improvements.md`
- Implementierung: `implementation.md`
