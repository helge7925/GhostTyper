# GhostTyper: Features (kompakt)

Stand: 2026-05-07

Dieses Dokument ist bewusst kurz gehalten. Der produktnahe Feature-Überblick steht im [`../README.md`](../README.md).

## Kernüberblick

- Produktüberblick und Nutzenversprechen: [`../README.md`](../README.md)
- Setup und Betrieb: [`../README.md`](../README.md) + [`docker-setup.md`](docker-setup.md)
- Versions-/Release-Stand: [`../CHANGELOG.md`](../CHANGELOG.md)
- Produktivitätsfeatures:
  - Audio-Transkription via Mistral Voxtral (Datei-Upload + Browser-Aufnahme)
  - Remote-Meeting-Bot (Google Meet, Microsoft Teams, Zoom + Nextcloud
    Talk via Fork) mit Live-Transkript-Streaming
  - OCR auf PDF/Bild via Mistral OCR
  - Datentabellen mit Metadaten, Zeilentiteln, Spaltentiteln und
    Excel-/CSV-/HTML-Export
  - Excel-artiger Tabellen-Vorlagen-Editor mit Live-Validierung
  - Auto-Glossar (Vorschläge aus eigener Transcription-Historie)
  - Intelligente Modellauswahl mit Kostenvorschau vor Start
  - Budget-Guardrails + Traffic-Light vor Start
  - Übersetzung kompletter Office-Dokumente (DOCX/XLSX/PPTX) unter
    Beibehaltung des Layouts
  - Multi-Workspace mit Rollen (`viewer`/`auditor`/`member`/`admin`/`owner`)
  - Audit-Log + Upload-Virenscan-Hook (clamscan optional)
  - PDF-Export der Analyse mit konfigurierbarem Theme

## Vertiefung nach Thema

- Architektur: [`architecture.md`](architecture.md)
- Audio-/Upload-Flow: [`audio-upload.md`](audio-upload.md)
- KI-/Provider-Details: [`ai-integration.md`](ai-integration.md)
- Tabellen-Vorlagen: [`TABLE_TEMPLATES.md`](TABLE_TEMPLATES.md)
- Konzept Foto-zu-Tabellenvorlage (Roadmap, nicht implementiert):
  [`konzept-automatische-tabellengenerierung-aus-foto.md`](konzept-automatische-tabellengenerierung-aus-foto.md)
- Vexa-Remote-Meeting (Operator-Guide): [`vexa-integration.md`](vexa-integration.md)
- Authentifizierung (NextAuth + OIDC + Credentials):
  [`authentication.md`](authentication.md)
- Tests/Abnahme: [`testing.md`](testing.md) +
  [`e2e-regression-matrix.md`](e2e-regression-matrix.md)

## Customer-Variants (eigene Repos)

- **Romaco-Scriptor** — Pharma-Variante, Vexa eingeschaltet, Pharma-Glossar
- **Korrotec-Scriptor** — Korrosionsschutz-Variante OHNE Vexa, mit
  4 eingebauten Datentabellen-Vorlagen (Schichtdicke, Strahl,
  Vorbehandlung, Tagesrapport) + Korrotec-Glossar
