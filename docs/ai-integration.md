# KI-Integration über OpenRouter

GhostTyper verwendet OpenRouter als einzigen anwendungsseitigen KI-Provider.
Vexa und Nextcloud bleiben eigenständige Integrationen. OpenRouter kann intern
unterschiedliche Modellanbieter routen, sofern deren Endpunkte Zero Data
Retention unterstützen und keine Datensammlung durchführen.

## Konfiguration und Governance

Organisationsadmins konfigurieren unter
`/settings/organization/integrations` einen verschlüsselt gespeicherten
OpenRouter-Schlüssel, eine Allowlist und je ein Standardmodell für `chat`,
`ocr`, `transcription`, `liveTranscription` und `tts`. Modell-Slugs kommen
ausschließlich aus dem dynamischen OpenRouter-Katalog. Das optionale
`OPENROUTER_API_KEY` ist ein Operator-Fallback; es ersetzt keine vollständige
Allowlist und keine Standards.

Die Aktivierung führt kleine kostenpflichtige Proben für alle fünf Fähigkeiten
aus. Erst danach wird die Organisation atomar auf OpenRouter geschaltet und
Legacy-Schlüssel werden entfernt. Ein nicht verfügbares Nutzermodell wird
genau einmal durch den Organisationsstandard derselben Fähigkeit ersetzt.

## Laufzeitpfade

- Chat, Analyse, Übersetzung, Textoptimierung und Vorlagen verwenden
  `/chat/completions`.
- Batch- und Live-STT verwenden `/audio/transcriptions` mit Base64-Audio.
- TTS verwendet `/audio/speech`; Audio für WAV-Streams wird per ffmpeg auf
  22.050 Hz, 16 Bit und Mono normalisiert.
- Bilder werden als Base64-Bildeingabe an das freigegebene OCR-Modell gesendet.
- PDFs verwenden den OpenRouter-`file-parser` mit `mistral-ocr` und liefern
  Markdown in den bestehenden GhostTyper-Vertrag zurück.

Jeder Request setzt `provider.zdr=true` und
`provider.data_collection="deny"`. API-Schlüssel und interne Routingdetails
werden nicht an Clients ausgegeben.

## Katalog, Preise und Budgets

Der serverseitige Katalog schneidet die für den Schlüssel verfügbaren Modelle
mit ZDR-fähigen Modellen. Er wird zehn Minuten gecacht; ein bis zu 24 Stunden
alter Stand ist nur für die Modellanzeige zulässig. Allowlist und Standards
bleiben in der verschlüsselten Integrationskonfiguration.

Budgets, Preise und Usage werden ausschließlich in USD geführt. Katalogpreise
werden für erlaubte Modelle versioniert; nicht normalisierbare Preisstrukturen
benötigen vor Freigabe einen manuellen Preis. Für abgeschlossene Requests ist
`usage.cost` maßgeblich. TTS-Kosten werden über die OpenRouter-Generation-ID
nachgeladen.

Weitere Details und Abnahmekriterien stehen in
`openspec/changes/consolidate-ai-providers-openrouter/`.
