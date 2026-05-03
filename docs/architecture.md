# Architecture

GhostTyper is a self-hosted Next.js application backed by PostgreSQL, with
optional containers for remote-meeting transcription. This page describes
the runtime topology and the data flows.

## Components

| Container | Purpose | Required |
| --- | --- | --- |
| `transkription-webapp` | Next.js app + background worker | yes |
| `transkription-db` | PostgreSQL 16 | yes |
| `vexa-lite` | Meeting-bot orchestrator (Vexa, Apache‑2.0) | optional, profile `vexa` |
| `vexa-db-init` | One-shot DB bootstrap for Vexa | optional, profile `vexa` |
| `fireworks-bridge` | Tiny Python proxy that rewrites Whisper model name and pulls the API key from the webapp at request time | optional, profile `vexa` |

The webapp and the database are always running. The remote-meeting stack
is opt-in via the `vexa` Compose profile **and** a per-workspace toggle.

## Network

All containers share the `internal` Docker network. Only the webapp is
exposed (port 3000 directly or via Traefik on 80/443). Vexa Lite, the
bridge and Postgres remain internal.

```
                 ┌─────────────┐
                 │   Browser   │
                 └──────┬──────┘
                        │ HTTPS (Traefik) or :3000
                        ▼
       ┌────────────────────────────────┐
       │   transkription-webapp         │
       │   Next.js + transcription-     │
       │   worker + observability       │
       └──┬──────────────┬──────────────┘
          │ pg-pool      │ HTTP (REST + WS)
          ▼              ▼
    ┌──────────┐   ┌──────────────┐
    │ Postgres │   │ vexa-lite    │
    │   16     │   └─┬────────────┘
    └──────────┘     │
                     │ POST /v1/audio/transcriptions
                     ▼
             ┌─────────────────────┐
             │ fireworks-bridge    │  ◄── pulls effective key
             └─────────┬───────────┘     from webapp every 60 s
                       │
                       ▼
              ┌────────────────┐
              │ Fireworks      │
              │ Whisper API    │
              └────────────────┘
```

## Data flows

### File-based transcription
1. User uploads audio. The request lands in `pages/api/transcriptions/index.js`,
   which writes a row to `transcriptions` and queues a job.
2. `lib/transcription-worker.js` claims the job, fetches the user's
   resolved Mistral key (workspace-level wins; per-user as fallback), and
   sends the audio to Mistral's Voxtral endpoint.
3. The worker streams segments back, persists them, and (if `auto_analyze`
   is set) runs `lib/manual-analysis.js` for the summary/template result.
4. The browser subscribes to `/api/transcriptions/[id]/stream` (SSE) for
   live updates.

### Remote-meeting transcription
1. User pastes a meeting link. `pages/api/meetings/index.js` resolves the
   workspace's Vexa config (`lib/integrations.js → resolveVexaConfig`),
   provisions a per-user Vexa token, and asks Vexa to spawn a bot.
2. Vexa joins the meeting (Playwright/Chromium), captures audio, and posts
   chunks to `http://fireworks-bridge:8080/v1/audio/transcriptions`.
3. The bridge rewrites the model name (`whisper-1` / `large-v3-turbo` →
   `whisper-v3`) and forwards the request to Fireworks. The Bearer token
   is fetched from `/api/internal/whisper-config` (cached 60 s) — the
   workspace admin can rotate the key in the UI without container restart.
4. Fireworks returns segments. Vexa stores them and emits status webhooks
   to `/api/webhooks/vexa` (HMAC-signed, replay-protected).
5. On `meeting.completed`, the webhook handler pulls the final transcript,
   maps it to GhostTyper's segment format, and triggers the same analysis
   path as file uploads. Whisper seconds are logged into `usage_log` for
   per-user cost attribution.

### Authentication and authorisation
- NextAuth issues JWT cookies; sessions carry `currentOrganizationId` and
  the user's organisation list.
- API routes wrap their handlers with `withOrgScope({ permission })` from
  `lib/api/with-org-scope.js`. The wrapper resolves the active workspace,
  verifies membership, and (optionally) checks a permission against the
  matrix in `lib/permissions.js`.
- Sensitive data (provider keys, webhook secrets) is encrypted at rest via
  AES-256-GCM (`lib/secrets.js`) and never returned to the browser.

## Database highlights

| Table | Notes |
| --- | --- |
| `users`, `organizations`, `organization_members` | Multi-tenant primitives |
| `transcriptions` | Both upload and Vexa rows; `source` discriminates |
| `transcription_events` | Stage timeline per transcription |
| `usage_log` | Per-call cost accounting (model, operation, tokens, EUR) |
| `audit_log` | Org-scoped audit trail |
| `organization_integrations` | Encrypted provider configs (Mistral, Fireworks, Vexa) |
| `vexa_user_tokens` | Per-user Vexa identities (encrypted) |
| `vexa_webhook_events` | Idempotency for inbound webhooks |
| `settings` | Per-user prefs incl. `remote_meeting_enabled` opt-out |

Migrations live in `lib/db-init.js` and are applied via the protected
`POST /api/db-init` endpoint at deploy time.

## Resource footprint

Whisper inference is delegated to Fireworks AI, so the host does not
need a GPU. A reasonable sizing matrix:

| Profile               | RAM   | CPU    | Disk      | Notes                                |
| --------------------- | ----- | ------ | --------- | ------------------------------------ |
| Minimum (without Vexa) | 2 GB  | 1 vCPU | 10 GB     | webapp + Postgres                    |
| With `vexa` profile   | 4 GB  | 2 vCPU | 20 GB     | + vexa-lite (2 GB) + bridge (256 MB) |
| 5–10 active users     | 8 GB  | 4 vCPU | 40 GB SSD | comfortable for daily team usage     |

Per concurrent live meeting, the Vexa container spawns a Chromium
process that adds roughly 1 GB of transient RAM until the bot leaves
the meeting. The `vexa-lite` image is published for `linux/amd64` only;
running it on Apple Silicon falls back to emulation and is noticeably
slower than native AMD64 hosts.

The webapp container itself has no hard memory limit configured (Next.js
is fairly steady around 300–500 MB); Postgres should be tuned per the
official `postgresql.conf` guidance once the workload is known.

## Observability

- Structured JSON logs (set `LOG_FORMAT=json`).
- `GET /api/health` for liveness/readiness; extended payload behind a
  shared secret.
- `GET /api/admin/observability` exposes worker scan stats, queue depth,
  and HTTP-client latency histograms.
