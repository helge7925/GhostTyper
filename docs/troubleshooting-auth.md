# Authentifizierungs-Fehleranalyse & Prävention

## Problembeschreibung
Nach der Initialisierung der Anwendung via Admin-Seed-Skript traten massive Anmeldeschwierigkeiten auf. Der Benutzer konnte sich trotz korrektem Passwort nicht anmelden, da der Passwort-Vergleich (`bcrypt.compare`) fehlschlug.

## Ursachenanalyse
1. **Hash-Inkonsistenz bei Seed-Skript**: Das ursprüngliche `admin/seed` API-Skript hat bestehende Benutzer nur in der Rolle hochgestuft, aber das Passwort nicht aktualisiert. Bei manueller Hash-Eingabe in die Datenbank über externe Tools entstanden Inkompatibilitäten.
2. **Manuelle Fehleranfälligkeit**: Die manuelle Generierung von Hashes über CLI-Snippets und das anschließende Kopieren in SQL-Befehle führte zu Fehlern (Tippfehler in Spaltennamen wie `ema` statt `email`).
3. **Pfadfehler bei Notfall-Routen**: Temporär erstellte API-Routen zur Fehlerbehebung enthielten falsche relative Importpfade (z.B. `../../../lib/db`), was den Docker-Build verhinderte.
4. **Fehlende DB-Funktionen**: Die `pgcrypto`-Erweiterung war in der Standard-Postgres-Instanz nicht aktiviert, was ein direktes Hashen via SQL unmöglich machte.

## Durchgeführte Korrekturen
- Alle temporären API-Routen wurden gelöscht.
- Das Passwort wurde über eine App-interne Route (`bcryptjs`-konform) erfolgreich neu gesetzt.
- Die Pfadfehler wurden korrigiert, um den Build zu stabilisieren.

## Präventive Maßnahmen (implementiert)
1. **CLI Admin Seed**: Der Admin-Seed-Prozess wurde von einer API-Route zu einem lokalen CLI-Skript (`npm run seed-admin`) verschoben. Dies eliminiert das Risiko von unbefugten API-Aufrufen und automatisiert das korrekte Hashing.
2. **Verbesserte Validierung**: Passwort-Komplexitätsprüfungen (Groß-/Kleinschreibung, Sonderzeichen) sind nun sowohl im Frontend als auch im Backend aktiv.
3. **Sicherheits-Standard**: Alle sensitiven Operationen nutzen nun ausschließlich die App-internen Bibliotheken, um Versions-Mismatches bei Hashes zu vermeiden.
