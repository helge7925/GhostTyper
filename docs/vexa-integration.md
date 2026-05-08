# Vexa Remote-Meeting-Integration — Operator-Guide

GhostTyper kann Live-Meetings (Google Meet, Microsoft Teams, Zoom) automatisch
mitschneiden und transkribieren, indem ein Vexa-Lite-Bot dem Meeting beitritt
und das Transkript an GhostTyper zurückliefert.

## Zwei-Stufen-Opt-in

Die Funktion ist standardmäßig **vollständig aus**. Sie wird durch zwei
unabhängige Schalter aktiviert:

1. **Operator-Stufe** — Compose-Profil `vexa` aktivieren (siehe unten).
   Ohne Profil läuft kein Vexa-Container, GhostTyper ist unverändert.
2. **Workspace-Stufe** — Org-Admin schaltet in *Settings → Integrationen
   → Vexa Meeting-Bot* die Integration ein. Vor dem Toggle ist der
   „Remote-Meeting"-Button für niemanden sichtbar.

Beide Stufen müssen aktiv sein, damit ein Bot startet. Endnutzer brauchen
zusätzlich die Permission `meeting.start` (member+) und müssen pro Bot-Start
explizit per Consent-Checkbox zustimmen.

## Schnellstart: Compose-Bundle

Im selben `docker-compose.prod.yml` ist der Vexa-Lite-Container hinter dem
Profil `vexa` mitgeliefert. Die Vexa-Datenbank wird in der bestehenden
Postgres-Instanz angelegt (separate DB `vexa`, gleiches User/Password).

```bash
# .env (zusätzlich zu den bestehenden GhostTyper-Variablen)
COMPOSE_PROFILES=vexa
# MISTRAL_API_KEY ist derselbe Schlüssel, den GhostTyper auch für die
# Batch-Transkription nutzt — ein Schlüssel reicht für beide Pfade.
MISTRAL_API_KEY=<mistral-key>
VEXA_ADMIN_API_TOKEN=$(openssl rand -hex 32)
RECONCILE_API_SECRET=$(openssl rand -hex 32)

# Hochfahren
docker compose -f config/docker-compose.prod.yml --profile vexa up -d
```

Was du dadurch bekommst:
- `vexa-lite` Container (Default-Pin: `vexaai/vexa-lite:0.10.0-260430-1701`,
  2 GB RAM, 2 CPU, Health-Check auf Port 8056). Override via
  `VEXA_LITE_IMAGE` in der `.env` — z.B. auf den Nextcloud-Talk-fähigen
  Fork `ghcr.io/helge7925/vexa-bot-talk:0.10.0-talk.1`.
- `vexa-db-init` One-shot, der `CREATE DATABASE vexa` ausführt (idempotent)
- GhostTyper-Container weiß automatisch über `VEXA_BASE_URL=http://vexa-lite:8056`
  Bescheid (interne Compose-Adresse, niemals nach außen exponiert)
- **Operator-Dashboard** (Vexas eigene Next.js-UI für Bot-Health, VNC-View,
  Live-Transcript-Debug) ist im selben Container auf Port 3000 enthalten,
  exposed auf Host `127.0.0.1:${VEXA_DASHBOARD_HOST_PORT:-3300}`.
  Auth läuft über Vexas admin-api-Token, NICHT über GhostTyper-NextAuth —
  bewusst kein End-User-Tool.
- Browser-Bots laufen als Kindprozesse innerhalb des Vexa-Lite-Containers
  und beenden sich, sobald das Meeting endet — keine zurückbleibenden
  Container, keine Docker-Socket-Mounts.

## In-App-Konfiguration

Pro Workspace (durch einen Admin in der GhostTyper-UI):

1. **Settings → Integrationen → Vexa Meeting-Bot** öffnen.
2. *Base-URL* und *Admin-Token* sind im Bundled-Setup nicht zwingend zu
   pflegen — der Server-Fallback (`VEXA_BASE_URL`, `VEXA_ADMIN_API_TOKEN`
   aus dem Compose-Stack) greift, wenn die Felder leer bleiben. Manuelles
   Eintragen ist nur nötig, wenn die Org gegen einen externen Vexa läuft.
3. *Webhook-Secret* setzen (frei gewähltes HMAC-Geheimnis, idealerweise
   `openssl rand -hex 32`). Dieses Geheimnis bleibt org-spezifisch.
4. *Standard-Bot-Anzeigename* und *Standard-Sprache* festlegen.
5. „Verbindung testen" klicken — grün = OK.
6. „Integration aktiv" einschalten und Speichern.

GhostTyper speichert alle Werte verschlüsselt in `organization_integrations`
(via `lib/secrets.js`, AES-256-GCM, Master-Key über `SETTINGS_ENCRYPTION_KEY`).
Klartext-Tokens werden nie an den Browser zurückgegeben.

## Architektur

```
GhostTyper (Next.js)        Vexa Lite (EU-Container)        Mistral Voxtral
──────────────────          ──────────────────────          ─────────────────
POST /api/meetings  ──►     POST /bots
SSE /api/transcriptions/                                    OpenAI-kompat.
  stream ◄── vexa-bridge ◄  GET /transcripts/…   ──────►   /v1/audio/transcriptions
POST /api/webhooks/vexa  ◄── HMAC-Webhook (meeting.completed)
                                  │
                                  └─► fireworks-bridge (Modell-Rewrite,
                                       MISTRAL_API_KEY-Lookup, context_bias-Injektion,
                                       response_format=verbose_json)
```

GhostTyper hat keinen direkten Zugriff auf die Audiospur — Vexa Lite
orchestriert den Browser-Bot, ruft die Transkription via Bridge bei
Mistral Voxtral auf und meldet Ereignisse via signiertem Webhook zurück.

## Operator-Dashboard

Im `vexa-lite`-Image ist Vexas eigene Next.js-Dashboard-UI gebündelt
(Port 3000 intern). Der Compose-Stack mappt sie auf Host
`127.0.0.1:${VEXA_DASHBOARD_HOST_PORT:-3300}` — also nur lokal vom
Server aus erreichbar. Per SSH-Tunnel kommst du vom Laptop ran:

```bash
ssh -L 3300:127.0.0.1:3300 user@<vps>
# dann im Browser http://localhost:3300
```

Was die Dashboard-UI bietet (komplementär zu GhostTyper):
- **Live-Transkript-Viewer** mit Speaker-Labels (WebSocket-basiert)
- **Recording-Playback** synchron zu Segmenten
- **VNC-View** für „authenticated mode"-Bots (echtes Google-Login im Bot-Browser)
- **Browser-Session-Verwaltung** für persistente Bot-Logins
- **Vexa-API-Token-Verwaltung** + Webhook-Konfiguration
- **Admin-Analytics** (User- und Meeting-Statistiken)

**Auth-Hinweis:** Die UI authentifiziert sich gegen Vexas eigene
admin-api (eigener User-Pool, eigene Tokens) — **nicht** gegen
GhostTyper-NextAuth. Endnutzer haben in dieser UI nichts zu suchen;
sie ist als Operator-Debug-Tool gedacht und Auth-mäßig schwach
gegenüber Public-Traffic-Brute-Force. Falls du das Dashboard doch
public exponieren willst (z.B. hinter Traefik), unbedingt eine
zweite Auth-Schicht (Basic-Auth, Forward-Auth) davorsetzen und den
`127.0.0.1`-Bind-Prefix in der Compose-Datei entfernen.

Erst-Login: per `VEXA_ADMIN_API_TOKEN` einen Vexa-User mit API-Token
anlegen (siehe `admin-api`-Doku im Vexa-Repo), dann im Dashboard mit
diesem Token einloggen.

## Was du betreiben musst

1. **Vexa Lite Container** (Apache-2.0, single container, GPU-frei)
   — z. B. auf Fly.io Frankfurt, Hetzner, Render. Empfohlen: konkretes
   Image-Tag pinnen (z.B. `vexaai/vexa-lite:0.10.0-260430-1701`),
   nicht `:latest`. Für Nextcloud-Talk-Support setze `VEXA_LITE_IMAGE`
   in der `.env` auf den Fork-Build aus
   [helge7925/vexa](https://github.com/helge7925/vexa) — siehe dort
   `UPSTREAM-SYNC.md` für die Tag-Konvention.
2. **Mistral Voxtral**: derselbe API-Key, den GhostTyper bereits für die
   Batch-Transkription nutzt. Die Bridge schreibt den Modellnamen auf
   `voxtral-mini-latest`, setzt `response_format=verbose_json` und
   `timestamp_granularities=word`, falls Vexa-Lite sie nicht selbst
   sendet, und injiziert die workspace-globale Kontext-Wörter-Liste.
3. **Postgres** für Vexa Lite — im Default-Compose-Stack wird die DB
   `vexa` in derselben Postgres-Instanz angelegt wie die GhostTyper-DB
   (siehe `vexa-db-init`-Service). Externe Postgres (Supabase EU,
   Neon EU) sind möglich, dann `DATABASE_URL` in den Vexa-ENV
   überschreiben.

## Vexa-Lite-ENV (auf dem Vexa-Container, nicht in GhostTyper)

```
DATABASE_URL=postgresql://…           # Postgres für Vexa
TRANSCRIPTION_SERVICE_URL=http://fireworks-bridge:8080/v1/audio/transcriptions
TRANSCRIPTION_SERVICE_TOKEN=<beliebiger Token; Bridge tauscht ihn>
ADMIN_API_TOKEN=<32 zufällige hex bytes — openssl rand -hex 32>
```

Der `TRANSCRIPTION_SERVICE_TOKEN` ist nur ein Platzhalter — der Bridge-
Container ersetzt das Bearer-Token vor dem Forward zu Mistral durch den
zur Laufzeit aufgelösten `MISTRAL_API_KEY` (Workspace-Override aus der
GhostTyper-UI bevorzugt vor `MISTRAL_API_KEY`-ENV).

Health-Check:
```bash
curl https://<vexa-host>/                                # 200 OK
curl -H "X-Admin-API-Key: $ADMIN_API_TOKEN" \
     https://<vexa-host>/admin/users?limit=1             # 200 + JSON
```

## GhostTyper-Konfiguration

Pro Workspace einzeln, durch einen Admin in der GhostTyper-UI:

1. **Settings → Integrationen → Vexa Meeting-Bot** öffnen.
2. Felder ausfüllen:
   - *Vexa Base-URL* — z. B. `https://vexa-lite.example.eu`
   - *Admin-Token* — der `ADMIN_API_TOKEN` aus dem Vexa-Container
   - *Webhook-Secret* — frei wählbares HMAC-Geheimnis (32 random bytes)
   - *Standard-Bot-Anzeigename* — z. B. „Acme Notes"
   - *Standard-Sprache* — `de`, `en` oder `auto`
3. „Verbindung testen" klicken — grün = OK.
4. „Integration aktiv" einschalten und Speichern.

GhostTyper speichert alle Werte verschlüsselt in `organization_integrations`
(via `lib/secrets.js`, AES-256-GCM, Master-Key über `SETTINGS_ENCRYPTION_KEY`).
Klartext-Tokens werden nie an den Browser zurückgegeben.

## Webhook-Registrierung (automatisch)

Ab dem ersten Bot-Start je User legt GhostTyper automatisch einen
Vexa-User-Token an *und* registriert für diesen Token die Webhook-URL
(`<NEXTAUTH_URL>/api/webhooks/vexa`) plus das org-spezifische Webhook-Secret
und die relevanten Events bei Vexa. Der Operator muss nichts manuell tun.

Schlägt die Webhook-Registrierung fehl, bleibt der Bot trotzdem startbar —
der Reconcile-Cron (siehe unten) holt verlorene Events nach.

## Reconcile-Cron

Webhooks haben Vexa-seitig eine Retry-Window von 24h. Trotzdem empfehlen wir
einen Cron-Backstop, der offene Vexa-Meetings, die seit ≥5 min keinen
Webhook mehr bekommen haben, aktiv pollt:

```
*/10 * * * *  curl -X POST https://<ghosttyper>/api/admin/vexa/reconcile \
                -H "X-Reconcile-Secret: $RECONCILE_API_SECRET"
```

`RECONCILE_API_SECRET` ist eine separate ENV-Variable im GhostTyper-Server,
die der Reconcile-Endpoint per timing-safe-Compare prüft.

## Bot tritt einem authentifizierten Meeting bei

Manche Meetings (Workspace-only, Lobby-pflichtig) erfordern einen
eingeloggten Browser-Account. Der Vexa-Bot kann persistente Sessions in
S3 speichern — siehe `features/authenticated-meetings/` im Vexa-Repo.
Dieses Setup ist außerhalb des MVP, dokumentiere bei Bedarf separat.

## DSGVO-Hinweise

- Der Bot tritt **sichtbar** mit dem konfigurierten Anzeigenamen bei.
  Teilnehmer müssen über die Aufzeichnung informiert sein und zustimmen.
- GhostTyper erzwingt eine Consent-Checkbox vor jedem Bot-Start. Die
  Bestätigung wird im Audit-Log persistiert
  (`action='meeting.bot.start', metadata.consent=true`).
- Daten-Lokalität: Vexa Lite läuft im EU-Container; Mistral hostet in
  Frankreich (EU). GhostTyper-DB unverändert.
- Retention: `scripts/apply-retention-policy.js` greift weiterhin —
  Vexa-Transkripte sind reguläre `transcriptions`-Rows mit `source='vexa'`.

## Troubleshooting

| Symptom | Ursache | Lösung |
|---|---|---|
| 400 INTEGRATION_DISABLED beim Start | Vexa-Toggle aus | Settings → Integrationen → aktivieren |
| 502 VEXA_BOT_FAILED | Bot konnte Meeting nicht beitreten | Vexa-Logs prüfen; bei Lobby ggf. authentifizierte Session |
| Webhook 401 INVALID_SIGNATURE | Webhook-Secret in Vexa und GhostTyper unterschiedlich | Org-Settings auf gleichen Wert setzen |
| Status hängt auf 'processing' | Webhook erreicht GhostTyper nicht | Reconcile-Cron läuft? Vexa-User-Webhook gesetzt? |
| Live-Transkript erscheint nicht | Bridge nicht gestartet | Detail-Seite refreshen; Worker läuft? `lib/vexa-bridge.js` Logs prüfen |
| `ENCRYPTION_UNAVAILABLE` | `SETTINGS_ENCRYPTION_KEY` fehlt | ENV setzen und Server neu starten |

## Verwandte Code-Stellen

- `lib/api/vexa.js` — REST-Client + Adapter (`mapVexaTranscriptToGhostTyper`)
- `lib/vexa-bridge.js` — Live-Polling-Bridge
- `lib/vexa-webhook-signature.js` — HMAC-Verifikation
- `lib/integrations.js` — verschlüsselte Org-Konfig
- `pages/api/meetings/*` — Bot-Lifecycle
- `pages/api/webhooks/vexa.js` — Event-Receiver
- `pages/api/admin/vexa/reconcile.js` — Cron-Backstop
- `components/MeetingStartForm.js` — Start-Dialog (mit Consent)
- `components/MeetingControlBar.js` — Sprache wechseln / Stop
- `components/settings/VexaIntegrationPanel.js` — Settings-UI

## Tests

```bash
npm test  # Adapter, URL-Parser, HMAC-Verifikation
```

Ein End-to-End-Test gegen einen echten Vexa-Lite + ein Sandbox-Google-Meet
ist manuell zu fahren — siehe `docs/code-review-priorities-*` für das
Test-Protokoll.
