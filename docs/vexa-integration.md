# Vexa-Live-Transkription über OpenRouter

Vexa Lite bleibt die Meeting-Bot-Komponente. Der Service `voxtral-bridge` trägt
aus Kompatibilitätsgründen weiterhin seinen historischen Namen, leitet jedoch
ausschließlich an `https://openrouter.ai/api/v1/audio/transcriptions` weiter.
Er wandelt Vexas Multipart-Audio in OpenRouters Base64-JSON-Vertrag um.

## Konfiguration

```env
COMPOSE_PROFILES=vexa
VEXA_ADMIN_API_TOKEN=<random>
BRIDGE_SHARED_SECRET=<random>
OPENROUTER_API_KEY=
OPENROUTER_LIVE_TRANSCRIPTION_MODEL=
```

Organisationen konfigurieren Schlüssel und `liveTranscription`-Standard in der
OpenRouter-Integrationsseite. Die Bridge fragt diese Daten authentifiziert über
`/api/internal/whisper-config` ab und hält sie höchstens 60 Sekunden im Cache.
Der Operator-Fallback wird nur verwendet, wenn kein Organisationsschlüssel
aufgelöst werden kann. Es gibt keinen Fallback zu einem alten KI-Provider.

## Datenfluss

1. Vexa sendet Audio und Meeting-Metadaten an die Bridge.
2. Die Bridge lädt Schlüssel, Modell und Probe-Status von GhostTyper.
3. Audio wird Base64-kodiert; Routing setzt ZDR und verbietet Datensammlung.
4. `verbose_json` wird nur für ein erfolgreich segmentgeprüftes Live-Modell
   angefordert.
5. GhostTyper normalisiert Segmente und rechnet Usage in USD ab.

Kontextbegriffe werden nicht ungeprüft als providerfremde Multipart-Felder
weitergeleitet. Wenn das gewählte Modell keine geeignete Option unterstützt,
bleibt der Kontext ungesendet und wird im Betrieb als Einschränkung behandelt.

## Lokaler Start

```bash
docker compose -f config/docker-compose.prod.yml --env-file .env --profile vexa up -d --build
```

Danach OpenRouter in der Organisationsverwaltung konfigurieren und aktivieren,
bevor ein Meeting gestartet wird.
