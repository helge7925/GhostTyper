# GhostTyper: Detaillierte Feature- & Verbesserungs-Dokumentation

Dieses Dokument fasst alle seit dem letzten umfassenden Überblick (VPS Deployment Guide) vorgenommenen Änderungen, Fehlerbehebungen und Implementierungen zusammen. Es dient als umfassende Referenz für den aktuellen Funktionsumfang und die technische Basis.

---

## 1. Modul: Text-Assistent Task-Manager

### 1.1 Funktionalität & Workflow
- **Dynamische Aufgabenverwaltung**: Die KI-Aktionen des Text-Assistenten sind nun nicht mehr statisch codiert, sondern werden dynamisch aus der Datenbank (`text_tasks` Tabelle) geladen.
- **Benutzerdefinierte Aufgaben**: Nutzer können in den `Einstellungen` eigene Text-Assistent-Aufgaben anlegen, deren Prompt-Text bearbeiten und nicht benötigte Aufgaben löschen.
- **Favoriten-System**: Aufgaben können als Favoriten markiert werden. Diese werden im Text-Assistenten UI farblich hervorgehoben und priorisiert angezeigt, um einen schnellen Zugriff auf häufig genutzte Funktionen zu ermöglichen.
- **Automatische Initialisierung**: Beim ersten Besuch der Einstellungsseite werden Standard-Tasks (Korrektur, Umformulieren, To-Dos etc.) automatisch in die `text_tasks`-Tabelle des Benutzers migriert, um einen schnellen Start zu ermöglichen.
- **Speicher-Funktion**: Ergebnisse aus dem Text-Assistenten können nun direkt im `DocumentEditor` über den "Speichern"-Button als neue Einträge in der Historie abgelegt werden. Der Titel des Historien-Eintrags reflektiert die verwendete Aufgabe und das Datum.

### 1.2 Technische Umsetzung
- **Datenbank-Schema**: Neue Tabelle `text_tasks` mit Spalten für `name`, `prompt`, `is_favorite`, `position` und `user_id`.
- **API-Endpunkte**:
    - `/api/text-tasks` (GET, POST): Zum Abrufen aller Aufgaben und zum Erstellen neuer Aufgaben.
    - `/api/text-tasks/[id]` (PUT, DELETE): Zum Aktualisieren (inkl. Favoriten-Status) und Löschen spezifischer Aufgaben.
- **Frontend-Integration**:
    - `pages/settings.js`: Neue UI-Sektion zur Verwaltung der `text_tasks` (Erstellen, Bearbeiten, Löschen, Favoriten).
    - `pages/text-ai.js`: Lädt die Aufgaben dynamisch aus der DB und rendert die Buttons entsprechend. Der `action`-Parameter im POST-Request zum `/api/text-ai` ist nun die ID der Aufgabe.
    - `lib/api.js`: Neue Helferfunktionen für `text-tasks` CRUD-Operationen.

---

## 2. UI/UX & Design-Konsistenz

### 2.1 Editor-Design & Funktionalität
- **Design-Vereinheitlichung**:
    - Das **Übersetzungs-Tool** (`pages/translate.js`) nutzt nun ebenfalls den vollwertigen `DocumentEditor` zur Anzeige der Übersetzungs-Ergebnisse. Dies stellt ein konsistentes Look & Feel und die Nutzung aller Editor-Features (Kopieren, DOCX/PDF-Export, Bearbeiten) sicher.
    - **Adaptive Höhe des Editors**: Der `DocumentEditor` passt seine Mindesthöhe dynamisch an den Inhalt an (`min-h-[300px]` bzw. `md:min-h-[500px]`), um bei kürzeren Texten keine unnötig lange "Papier"-Fläche zu generieren.
- **Interaktive Elemente**:
    - **Kopier-Funktion im Editor**: Ein neuer "Kopieren"-Button in der Navbar des `DocumentEditor` ermöglicht das einfache Kopieren des gesamten Editor-Inhalts in die Zwischenablage, inkl. visuellem Feedback ("Kopiert!").
    - **Speicher-Feedback im Editor**: Der "Speichern"-Button im `DocumentEditor` (speziell im Text-Assistent) zeigt nun visuelles Feedback ("Gespeichert!") an, nachdem das Dokument erfolgreich in der Historie abgelegt wurde.

### 2.2 Sprachunterstützung & Lokalisierung
- **Chinesisch (中文)**: Als neue Übersetzungsoption in allen relevanten Modulen (DocumentEditor, Transkriptionen, OCR, Übersetzungs-Tool) hinzugefügt.

### 2.3 Historien-Ansicht
- **Optimiertes Layout**: Die Historien-Seite (`pages/transcriptions.js`) nutzt nun eine `max-w-7xl` Breite mit horizontalem Padding (`px-4 sm:px-6 lg:px-8`), um den verfügbaren Bildschirmplatz besser auszunutzen und horizontales Scrollen zu eliminieren.
- **Präzises Type-Labeling**: Einträge in der Historie werden jetzt korrekt als "Text-Assistent" oder "Übersetzung" gelabelt, anstatt als generische "Transkription", was die Übersichtlichkeit erheblich verbessert.

---

## 3. Technische Verbesserungen & Robustheit

### 3.1 Markdown-Rendering & Export
- **Professionelles Markdown-Rendering**: Die Integration der `marked`-Library in `lib/export-utils.js` (mittels `mdToHtml`) ermöglicht die robuste und korrekte Konvertierung von Markdown-Inhalten (inkl. **Tabellen**, Überschriften, Listen, Fett-/Kursivdruck) in HTML für die Darstellung im `DocumentEditor`. Dies gilt für alle Module (OCR, Transkriptionen, Text-Assistent).
- **PDF-Export (Finaler Fix)**: Die Druck-Logik im `DocumentEditor` wurde vollständig überarbeitet:
    - Browser-generierte Header und Footer (URL, Datum, Titel) werden durch `margin: 0` auf `@page` unterdrückt.
    - Simulations von Seitenrändern erfolgt durch `padding` direkt auf dem Inhalt (`#editor-content-to-print`).
    - Alle Nicht-Inhaltselemente werden gezielt mittels `no-print` Klasse und CSS `display: none !important;` ausgeblendet, um eine absolut saubere PDF-Ausgabe zu gewährleisten.

### 3.2 KI-Service Stabilität
- **OCR-Zuverlässigkeit**: Verbesserungen in `lib/ai-service.js` bei der `performOCR`-Funktion:
    - Der `mime_type` wird nun explizit beim Upload des Dokuments an Mistral übermittelt.
    - Eine kurze Verzögerung (`1500ms`) wurde nach dem Dateiupload bei Mistral eingebaut, um sicherzustellen, dass die Datei für die OCR-Verarbeitung bereit ist und somit `500 - Service Unavailable` Fehler reduziert werden.

### 3.3 Datenbank-Anpassungen
- **Flexibilität für Textdokumente**: Die Spalten `filename`, `original_name` und `file_path` in der `transcriptions`-Tabelle wurden auf `NULL` zulässig (`DROP NOT NULL`) geändert. Dies erlaubt das Speichern von rein textbasierten Dokumenten (wie z.B. aus dem Text-Assistenten) ohne eine zugehörige Datei.

---

## 4. Sicherheit & Deployment-Vorbereitung

### 4.1 Authentifizierung & Admin-Verwaltung
- **CLI Admin-Seed Tool**: Die potenziell unsichere API-Route `/api/admin/seed` wurde entfernt und durch ein sicheres, lokal ausführbares CLI-Skript (`scripts/seed-admin.js`, erreichbar via `npm run seed-admin`) ersetzt. Dieses Skript ermöglicht das sichere Anlegen und Aktualisieren von Admin-Konten inklusive korrektem `bcryptjs`-Hashing und Passwortvalidierung.
- **Passwort-Validierung**: Verbesserte Passwort-Komplexitätsprüfungen (Mindestlänge, Groß-/Kleinbuchstaben, Zahl, Sonderzeichen) wurden sowohl für Admin-erstellte Benutzer als auch für Profil-Updates implementiert.
- **Temporäre Debugging-Routen entfernt**: Alle zu Debugging-Zwecken erstellten Routen (`temp-hash.js`, `temp-reset-password.js`) wurden nach erfolgreicher Fehlerbehebung entfernt.

### 4.2 Deployment-Dokumentation
- **`docs/troubleshooting-auth.md`**: Eine detaillierte Fehleranalyse und Lösungsvorschläge für Authentifizierungsprobleme.
- **`docs/vps-deployment-guide.md`**: Ein umfassender Leitfaden für ein vollständig isoliertes Deployment auf einem VPS unter Verwendung von Docker und Traefik, inklusive `.env`-Konfiguration, Initialisierungs- und Seed-Anweisungen.

---

*Dokumentation erstellt am 11. Februar 2026*
