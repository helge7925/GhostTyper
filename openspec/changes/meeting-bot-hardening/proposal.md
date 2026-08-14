# Change: Meeting-Bot Hardening (Vexa Reliability)

## Why

The remote-meeting bot is a genuinely valuable feature (live transcript,
live translation, TTS injection) but fragile in operation. Code review
(2026-07-16) verified four concrete weaknesses:

1. **Bridge dies on process restart.** `lib/vexa-bridge.js` keeps its
   polling state in `globalThis`; a deploy/restart during a meeting
   silently kills the live transcript and live translation. The
   reconcile worker only finalizes ENDED meetings — it never re-attaches
   the bridge to a still-running one.
2. **No poll backoff.** `pollOnce` logs fetch errors and keeps hammering
   at 500ms–2s cadence forever; no escalation, no user signal.
3. **Bot failure opacity.** A rejected/never-admitted bot surfaces only
   after the 60s reconcile tick as a generic `failed` — users watch an
   empty screen. There is no "waiting for admission" state and no
   detector for "bot admitted but hearing nothing" (muted/ejected).
4. **Lazy worker start.** Reconcile + transcription workers start only
   on first request after boot; a restarted idle instance reconciles
   nothing.

## Decisions Captured

- **Bridge recovery**: each reconcile tick SHALL re-attach bridges for
  rows `source='vexa' AND status IN ('pending','processing')` that have
  no active bridge (`isBridgeActive` guard makes this idempotent).
- **Backoff**: consecutive poll failures back off exponentially
  (base cadence → ×2 per failure, cap 60s, reset on success). After 10
  consecutive failures, emit a `vexa_degraded` transcription event
  (UI banner: "Verbindung zu Vexa gestört — versuche weiter …").
- **Status model**: extend `bot_status` mapping to
  `requested → joining → awaiting_admission → active →
  completed | failed | rejected`. Rejection/never-admitted (detectable
  from Vexa meeting status + join timeout) SHALL surface within 30s as
  a clear UI state with the tab-audio alternative linked.
- **Stale detector**: bot `active` but zero new segments for
  N minutes (default 3, env-tunable) → warning event + UI hint
  ("Bot hört nichts — stummgeschaltet oder entfernt?"). Auto-clears on
  the next segment.
- **Preflight**: the meeting start endpoint SHALL verify Vexa
  reachability + admin token validity before requesting a bot, and
  return a typed error otherwise (no more silent pending rows).
- **Worker autostart**: `ensure*WorkerRunning()` also invoked from a
  Next.js `instrumentation.js` hook so restarts self-heal without
  traffic.

## What Changes

- `lib/vexa-bridge.js`: backoff state per slot, degraded event, stale
  detector, exported `listActiveBridgeIds` for reconcile.
- `pages/api/admin/vexa/reconcile.js`: re-attach step + join-timeout →
  `rejected` mapping.
- `pages/api/meetings/index.js`: preflight check.
- `components/MeetingControlBar.js` / meeting UI: new status badges +
  banners (i18n de/en).
- `instrumentation.js`: worker autostart.
- Tests: backoff unit test, reconcile re-attach test (mocked query),
  status mapping test.

## Impact

- No schema change (`bot_status` is VARCHAR; new values additive).
- This is the GhostTyper mirror of the romaco-scriptor spec; the
  fork additionally covers its TTS-injection path. Implement upstream
  first, then port.
