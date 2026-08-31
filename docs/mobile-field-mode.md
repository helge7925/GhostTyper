# Mobile Field Mode

Der Mobile Field Mode hält Aufnahmen und Dokumentfotos bei instabiler oder
fehlender Verbindung lokal auf dem Gerät. Sobald die Verbindung zurückkehrt,
werden die Captures in den aktiven GhostTyper-Workspace übertragen und
serverseitig wie normale Uploads verarbeitet.

## Nutzung

1. GhostTyper einmal online in Android Chrome öffnen und über
   **Zum Startbildschirm hinzufügen** installieren.
2. Audio, OCR-Dokument oder Foto-zu-Tabelle wie gewohnt erfassen.
3. Offline gespeicherte Captures erscheinen im Status unten im App-Fenster.
4. Bei wiederhergestellter Verbindung startet die Synchronisierung automatisch.
   **Jetzt synchronisieren** stößt sie bei Bedarf manuell an.

Die Warteschlange bleibt nach einem Reload oder Geräte-Neustart in IndexedDB
erhalten. Jeder Capture besitzt eine stabile Client-ID. Der Server dedupliziert
diese ID innerhalb von Benutzer und Workspace, sodass ein Retry genau einen
Transkriptionsdatensatz erzeugt. Audio-Uploads starten nach der Synchronisierung
automatisch ihre normale Transkriptionsverarbeitung.

## Sicherheit und Cache-Policy

- API-Aufrufe sind immer `network-only`; der Service Worker speichert keine
  API-Antworten, Sitzungen, Transkriptionen oder anderen Workspace-Daten.
- Für den Offline-Start werden nur die statische Offline-Seite, Manifest,
  App-Icons und versionierte `/_next/static`-Assets gecacht.
- Captures sind in der lokalen Queue an Benutzer und aktiven Workspace gebunden.
  Ein Workspace-Wechsel synchronisiert keine Captures des vorherigen Workspace.
- IndexedDB liegt unverschlüsselt im Browserprofil. Verwaltete Geräte sollten
  per Gerätesperre geschützt sein; nach Abschluss empfiehlt sich das Leeren
  lokaler Website-Daten gemäß Betriebsrichtlinie.

## Grenzen und Fehlerbehandlung

Android Chrome ist das primäre und getestete Ziel. iOS Safari/PWA kann
Hintergrundarbeit, Wake Lock und längere Audioaufnahmen beim Sperren des Displays
unterbrechen. Die App kann keine Aufnahme fortführen, wenn Browser oder PWA
vollständig geschlossen wurden.

Der verfügbare IndexedDB-Speicher hängt von Gerät, Browser und freiem Platz ab.
Ist das Kontingent voll oder IndexedDB nicht verfügbar, zeigt die App einen
Fehler und behauptet nicht, der Capture sei sicher gespeichert. Validierungs-,
Berechtigungs- oder Budgetfehler werden nicht endlos erneut übertragen;
vorübergehende Netzwerk- und Serverfehler verwenden begrenztes exponentielles
Backoff und können manuell erneut angestoßen werden.

Offline-Inferenz ist nicht enthalten: STT, OCR und Tabellenanalyse benötigen
nach dem Upload weiterhin den GhostTyper-Server und die konfigurierten
Mistral-Dienste.

## Manuelle Abnahme

Auf einem verwalteten Android-Gerät mit Chrome:

1. PWA installieren und danach im Flugmodus neu starten.
2. Je einen Audio-, OCR- und Foto-zu-Tabelle-Capture offline speichern.
3. PWA vollständig schließen und erneut öffnen; Queue-Zähler prüfen.
4. Verbindung aktivieren und automatische beziehungsweise manuelle
   Synchronisierung testen.
5. Prüfen, dass pro Capture genau ein Datensatz entsteht und Audio in
   `queued`/`processing` wechselt.
6. Den Test mit Workspace-Wechsel wiederholen und sicherstellen, dass keine
   Capture-Daten in den anderen Workspace übertragen werden.
