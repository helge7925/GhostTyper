# Datenschutzbetrieb mit OpenRouter

GhostTyper sendet KI-Workloads ausschließlich serverseitig an OpenRouter. Jeder
Chat-, OCR-, STT- und TTS-Request setzt `provider.zdr=true` und
`provider.data_collection="deny"`. Der dynamische Modellkatalog wird zusätzlich
mit den ZDR-fähigen OpenRouter-Modellen geschnitten.

## Technische Mindestkonfiguration

- `OUTBOUND_ALLOWED_HOSTS=openrouter.ai`
- OpenRouter-Schlüssel verschlüsselt in der Organisationsintegration; optional
  `OPENROUTER_API_KEY` als Operator-Fallback
- fünf geprüfte Standardmodelle sowie aufgabenbezogene Allowlist
- Inhaltslogging im OpenRouter-Konto deaktiviert und Datenschutz-/Guardrail-
  Einstellungen regelmäßig kontrolliert
- Schlüssel, vollständige Providerfehler und Routingdetails nie an den Browser
  ausgeben

ZDR und `data_collection=deny` verhindern nicht automatisch internationale
Datenübermittlungen. Betreiber müssen die tatsächlich gerouteten Endpunkte,
Datenregionen und Unterauftragsverarbeiter ihrer freigegebenen Modelle prüfen.
Eine Freigabe ist nur zulässig, wenn Rechtsgrundlage, AVV/DPA, gegebenenfalls
SCC/TIA, Informationspflichten und Löschkonzept dokumentiert sind.

## Auftragsverarbeitung und Verzeichnis

Der AVV und das Verzeichnis von Verarbeitungstätigkeiten müssen mindestens
OpenRouter als Auftragsverarbeiter, mögliche geroutete Modellanbieter, Zweck,
Datenkategorien, Betroffenengruppen, Löschfristen, Schutzmaßnahmen und
Transfergrundlage nennen. Bei Meeting-Audio können besondere Kategorien
personenbezogener Daten betroffen sein; Einwilligung und Teilnehmerhinweise
sind deploymentspezifisch rechtlich zu prüfen.

## Nachweise und Betrieb

- Aktivierungs-Audit mit Zeitstempel, Proben-Generation-IDs und USD-Migration
- Usage-Log mit `provider=openrouter`, exaktem Modell-Slug und USD
- regelmäßige Kontrolle der Allowlist auf Ablaufdatum, ZDR und Preisstruktur
- dokumentierter Ablauf für Schlüsselrotation und Entfernen alter
  Provider-Umgebungsvariablen
- Retention-Job für Transkriptionen, Usage und Auditdaten überwachen

Die vollständigen technischen Anforderungen stehen in
`openspec/changes/consolidate-ai-providers-openrouter/`.
