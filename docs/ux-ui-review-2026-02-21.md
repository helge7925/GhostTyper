# UX/UI Review (2026-02-21)

## Ziel
Die Anwendung wurde auf Zuverlässigkeit der Bedienung, Konsistenz der Interaktion, Accessibility (WCAG-orientiert) und mobile Tauglichkeit geprüft.

## Umfang
Geprüfte Hauptbereiche:
- Login, Start, Layout, Sidebar
- Upload, OCR, Übersetzung, Text-Assistent
- Historie, Detailansicht, Admin, Einstellungen, Realtime
- Zentrale UI-Komponenten (`DocumentEditor`, `Toast`, `ProcessStatusCard`, `AudioUploadForm`, `TranscriptionCard`, `TableRenderer`)

## Methode
- Statische Code-Review mit Fokus auf Interaktionsmuster, Zustandsfeedback, A11y-Semantik und mobile Verhalten.
- Heuristische Bewertung (Nielsen + WCAG-Basis: Tastaturbedienung, Rollen/Labels, Statuskommunikation).

## Findings nach Priorität

### P0 (kritisch, zuerst umsetzen)

1. Blockierende Browser-Dialoge (`alert/confirm`) in Kernflows
- Impact: Unterbrechung des Workflows, schlechte mobile UX, keine konsistente Gestaltung, eingeschränkte Accessibility.
- Evidenz:
`pages/settings.js:235`
`pages/settings.js:409`
`pages/transcriptions.js:86`
`pages/transcriptions.js:132`
`pages/ocr.js:169`
`pages/admin/users.js:147`
`pages/transcriptions/[id].js:423`
- Empfehlung: Einheitliches Modal/Toast-System mit `aria-live` für Status und expliziten Confirm-Dialogen für destruktive Aktionen.

2. Toolbar im `DocumentEditor` ist per Tastatur nur eingeschränkt nutzbar
- Impact: Wichtige Formatierungsfunktionen sind primär mauszentriert (`onMouseDown`), dadurch Barrierefreiheits- und Usability-Defizit.
- Evidenz:
`components/DocumentEditor.js:507`
`components/DocumentEditor.js:515`
`components/DocumentEditor.js:522`
- Empfehlung: Toolbar-Buttons auf `onClick` umstellen, Tastaturkürzel ergänzen, ARIA-Labels und aktive Zustände (`aria-pressed`) ergänzen.

3. Icon-only Buttons ohne zugänglichen Namen
- Impact: Screenreader-Nutzer erhalten keine sinnvolle Bezeichnung; Touch-Ziele sind teils unklar.
- Evidenz:
`components/TranscriptionCard.js:52`
`components/TranscriptionCard.js:107`
`pages/transcriptions.js:160`
`pages/transcriptions.js:217`
`pages/translate.js:203`
`components/Toast.js:21`
- Empfehlung: `aria-label` ergänzen, Mindestgröße Touch-Targets sicherstellen, bei kritischen Aktionen sichtbaren Text bevorzugen.

4. Klickbare Drop-Zones ohne semantische Interaktivität
- Impact: Keyboard-only Nutzer können Upload-Zonen nicht zuverlässig bedienen.
- Evidenz:
`components/AudioUploadForm.js:190`
`components/AudioUploadForm.js:194`
`pages/ocr.js:192`
- Empfehlung: `<button>` oder `role="button"` + `tabIndex=0` + `onKeyDown` (Enter/Space) und klaren Fokusstil einführen.

### P1 (hoch)

5. Inkonsistente Feedback-Strategie (Toasts, Inline-Errors, Alerts gemischt)
- Impact: Nutzer lernen kein stabiles Interaktionsmuster; Fehlerbehandlung wirkt je Seite unterschiedlich.
- Evidenz:
`pages/text-ai.js:37`
`pages/translate.js:337`
`pages/settings.js:571`
`pages/transcriptions.js:86`
- Empfehlung: Globales Feedback-Pattern definieren: nicht-blockierende Toasts für Info/Success, modale Dialoge nur für Confirm.

6. `Toast` ohne Live-Region und ohne zugänglichen Close-Name
- Impact: Statusänderungen werden assistiven Technologien nicht zuverlässig kommuniziert.
- Evidenz:
`components/Toast.js:16`
`components/Toast.js:21`
- Empfehlung: `role="status"`/`aria-live="polite"` (bzw. `assertive` bei Fehlern), Close-Button mit `aria-label`.

7. Tab-Navigation in Einstellungen ohne ARIA-Tab-Semantik
- Impact: Erschwerte Navigation für Screenreader und Tastatur.
- Evidenz:
`pages/settings.js:670`
`pages/settings.js:672`
- Empfehlung: `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, Panels mit `role="tabpanel"`.

8. Mehrere Seiten rendern bei Ladezuständen `null` (Blank Screen)
- Impact: Wahrgenommene Instabilität und Orientierungslosigkeit beim Laden.
- Evidenz:
`pages/upload.js:179`
`pages/ocr.js:175`
`pages/translate.js:172`
`pages/transcriptions.js:147`
`pages/admin/users.js:164`
`pages/realtime.js:439`
- Empfehlung: Konsistenten Skeleton/Loading-State je Hauptseite einführen.

9. Globale Touch-Swipe-Listener in Sidebar können mit Seitengesten kollidieren
- Impact: Unerwartete Öffnen/Schließen-Effekte auf Mobilgeräten.
- Evidenz:
`components/Sidebar.js:104`
`components/Sidebar.js:105`
- Empfehlung: Gestenbereich eingrenzen (Edge Zone/Overlay), Konflikt mit horizontalem Scrollen vermeiden.

10. Eingabefelder teils ohne explizite Label-Verknüpfung
- Impact: Uneinheitliche Form-A11y, vor allem in komplexen Formularen.
- Evidenz:
`pages/realtime.js:468`
`pages/realtime.js:597`
`pages/admin/users.js:204`
- Empfehlung: Überall `label` + `htmlFor`/`id` standardisieren.

### P2 (mittel)

11. Sehr große, monolithische Settings-Seite
- Impact: Hohe kognitive Last, hohe Fehlerrate bei Bedienung, erschwerte Wartbarkeit.
- Evidenz:
`pages/settings.js:1`
- Empfehlung: In Subseiten oder klar getrennte Panels aufteilen (z. B. Konto, Templates, Workflows, Audit).

12. Detailseite Transkription enthält destruktive Aktion als sekundären Textbutton
- Impact: Löschaktion ist visuell niedrig gewichtet, aber hochriskant.
- Evidenz:
`pages/transcriptions/[id].js:423`
- Empfehlung: Gefährliche Aktionen klar in „Danger Zone“ mit zweistufigem Confirm (Dialog + optional Undo).

13. Suchfeld Historie ohne sichtbares Label
- Impact: Verständlichkeit und A11y leiden, besonders bei Screenreadern.
- Evidenz:
`pages/transcriptions.js:251`
- Empfehlung: Label oder `aria-label="Dateien durchsuchen"` ergänzen.

14. Nutzung von `document.execCommand` (deprecated)
- Impact: Langfristige Browser-Kompatibilitäts- und Stabilitätsrisiken im Editor.
- Evidenz:
`components/DocumentEditor.js:93`
`components/DocumentEditor.js:358`
- Empfehlung: Mittelfristig auf moderne Editing-Engine migrieren (z. B. ProseMirror/Tiptap/Lexical).

15. Sprach- und Tonalitätsmischung (Deutsch/Englisch) in zentralen UI-Texten
- Impact: Inkonsistentes Produktgefühl.
- Evidenz:
`pages/login.js:52`
`components/Layout.js:67`
- Empfehlung: Einheitliche Content-Styleguide-Regeln (de-DE primär, englische Begriffe nur bewusst).

### P3 (niedrig, Qualitätsverbesserungen)

16. Fokusstile bei vielen Controls uneinheitlich
- Impact: Tastatur-Navigation wirkt inkonsistent.
- Evidenz:
`pages/settings.js:695`
`pages/translate.js:237`
`components/TranscriptionCard.js:93`
- Empfehlung: globales `focus-visible` Token-Set einführen.

17. Tabellen-Editor: Zeilen-Löschen als Icon-only ohne Label
- Impact: geringe Entdeckbarkeit/Accessibility.
- Evidenz:
`components/TableRenderer.js:261`
- Empfehlung: `aria-label` + Tooltip konsistent, optional Textbutton auf kleinen Viewports.

## Umsetzungsplan (empfohlen)

1. Sprint A (P0)
- Replace `alert/confirm` durch App-Dialog/Toast-System.
- Editor-Toolbar keyboard-first refactor.
- Icon-only Buttons systematisch mit `aria-label` versehen.
- Drop-Zones semantisch interaktiv machen.

2. Sprint B (P1)
- Settings-Tab-Semantik + Form-Label-Standardisierung.
- Global Loading-Skeletons für alle Hauptseiten.
- Sidebar-Gesten auf mobile Edge-Handling umstellen.
- Toast-Komponente ARIA-fähig machen.

3. Sprint C (P2/P3)
- Settings in Subbereiche aufteilen.
- Danger-Zone-Muster in Detailseiten.
- Content-/Terminologie-Politur (de-DE Konsistenz).
- Fokusstil-System vereinheitlichen.

## Definition of Done für UX/UI-Hardening
- Keine `alert/confirm` mehr in produktiven Kernflows.
- Alle interaktiven Controls keyboard- und screenreader-tauglich.
- Einheitliches Feedback-System (Toast/Dialog/Inline) dokumentiert und angewendet.
- Jede Hauptseite zeigt einen konsistenten Ladezustand statt Blank Screen.
- A11y-Schnelltest (Keyboard-only + Screenreader Smoke) für Kernflows bestanden.
