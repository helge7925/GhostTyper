# Status: Meeting-Bot Hardening

Last updated: 2026-07-17

## Current State

- **Implemented on branch `feat/meeting-bot-hardening`, 2026-07-17**
  (stacked on `feat/retire-google-meet-bot`, HEAD 7ecb006).
- Independent of `retire-google-meet-bot` (applies to Teams/Zoom/
  Nextcloud Talk); landing together.
- Mirror of the romaco-scriptor spec; implemented here (upstream) first.
  The fork will port it (and additionally cover its TTS-injection path).

## What landed

- **Poll backoff** (`lib/vexa-bridge.js` + `lib/vexa-bridge-utils.js`):
  per-slot `consecutiveFailures`; next interval = `base * 2^failures`
  capped at 60s, reset to base on the first successful fetch. Integrated
  into the existing 2s / 500ms tick scheduler (base cadence unchanged at
  0 failures). After 10 consecutive failures → one `vexa_degraded`
  transcription event, re-armed only after an intervening success.
- **Stale detector** (`lib/vexa-bridge.js`): `slot.lastSegmentAt` set on
  the first real segment and refreshed on every signature change. If a
  producing bot goes quiet for `VEXA_STALE_AFTER_MS` (default 180000) →
  one `vexa_stale` warning; cleared + `vexa_recovered` emitted on the next
  segment. Gated on `lastSegmentAt` being set, so a never-producing bot is
  handled by the reconcile join-timeout instead of being mislabelled.
- **Bridge re-attach** (`pages/api/admin/vexa/reconcile.js`): in the
  still-running branch, `if (!isBridgeActive(row.id)) startBridgeForTranscription(row.id)`
  heals a bridge lost to a deploy/restart mid-meeting.
- **Join-timeout → rejected** (reconcile): early `bot_status`
  (requested/joining/awaiting_admission) older than `VEXA_JOIN_TIMEOUT_MS`
  (default 120000) with no segments and no "active" signal from Vexa →
  `status='error'`, `bot_status='rejected'`, friendly German error +
  transcription event, both pointing at tab-audio capture. Applied on both
  the Vexa-404 path and the still-running path.
- **Worker autostart** (`instrumentation.js`): `register()` dynamically
  imports and calls `ensureVexaReconcileWorkerRunning()` +
  `ensureTranscriptionWorkerRunning()` when `NEXT_RUNTIME === 'nodejs'`.
- **UI** (`components/MeetingControlBar.js`, `pages/transcriptions/[id].js`):
  friendly localized (de/en) bot-status label incl. `rejected`; the error
  box shows a tab-audio CTA when `bot_status==='rejected'`;
  `vexa_degraded` / `vexa_stale` / `vexa_recovered` render in the existing
  events timeline with new stage labels + dot colors.
- **Tests**: `tests/vexa-bridge-utils.test.mjs` (19 tests) covers backoff
  progression + 60s cap + reset, stale (threshold + once-only), and the
  join-timeout decision matrix. Full suite: 159 pass / 0 fail / 10 skipped
  (was 140/0/10). Lint 0 errors (2 pre-existing warnings in
  `pages/transcriptions.js`). `npm run build` compiles.

## Env vars added (see `.env.example`)

- `VEXA_STALE_AFTER_MS` — stale-detector threshold, default `180000` (3 min).
- `VEXA_JOIN_TIMEOUT_MS` — never-admitted join window, default `120000` (2 min).

Both are optional; defaults preserve current behavior for healthy meetings.

## Deviations & decisions

- **Preflight (spec §3.1) DEFERRED.** Not part of the implementation
  directive for this pass and it adds a network round-trip on the
  meeting-start hot path (risking the "healthy meetings unchanged" rule).
  The join-timeout → `rejected` path already eliminates the "silent
  pending row" symptom the preflight targeted, just reactively rather than
  up front. Left unchecked in tasks.md for a follow-up.
- **Join-timeout heuristic + Vexa-status tie-breaker.** Vexa exposes no
  dedicated "never admitted" status, so the timeout heuristic is the
  primary signal (as the spec anticipated). To avoid false-positives on a
  silent-but-present bot (common in the local Docker setup where the
  `meeting.started` webhook never arrives, so `bot_status` stays
  `requested`), rejection additionally requires that Vexa does **not**
  report the meeting active (`active/in_progress/recording/up/joined/
  started/live`) and that no segment exists anywhere. A Vexa 404 (meeting
  absent) counts as "not active". Conservative by construction: any
  positive activity signal suppresses rejection.
- **Re-attach placement.** Done only in the still-running branch (not for
  rows being finalized/rejected/failed), so we never spin up a bridge for
  a row that is about to close. Idempotent via `isBridgeActive`. Note the
  reconcile scan only loads rows stale > 1 min, which is exactly the set
  whose bridge may have died — a healthy bridge keeps `updated_at` fresh
  and is never re-attached.
- **Events timeline stays German.** The transcription-event system stores
  backend-authored German messages app-wide (not i18n'd at render time),
  so the three new stage labels follow that existing pattern. The
  genuinely new user-facing *labels* (bot-status incl. `rejected`) are
  fully de/en under `meeting.botStatus.*`.
- **`next.config.js` `serverExternalPackages`.** `instrumentation.js`
  transitively imports `lib/ai-service` (via the transcription worker),
  which pulls `fluent-ffmpeg` + `@ffmpeg-installer/ffmpeg`; their runtime
  `require()` breaks the instrumentation bundle tracer. Marking both as
  server-external fixes the build with no runtime change (API routes
  already auto-externalized them).

## Not verified here (needs a live environment)

- Kill-webapp-mid-meeting → restart → live transcript resumes within one
  reconcile interval.
- Stop Vexa container → `vexa_degraded` appears + polling slows; restart →
  recovers.

These exercise real timers + a live Vexa container and cannot run in CI /
this workspace. The decision logic behind them is unit-tested and the
build compiles.
