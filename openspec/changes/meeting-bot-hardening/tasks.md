# Tasks: Meeting-Bot Hardening

## 1. Bridge resilience
- [x] Backoff per slot in `lib/vexa-bridge.js` (fail counter, ×2 to 60s
      cap, reset on success); `vexa_degraded` event after 10 fails.
- [x] Stale detector: track `lastSegmentAt`; if bot active and no new
      segment for `VEXA_STALE_AFTER_MS` (default 180000) → warning
      event once, cleared on next segment.
- [x] Export `isBridgeActive` (exists) + use in reconcile re-attach.

## 2. Recovery & lifecycle
- [x] Reconcile tick: for active vexa rows without bridge →
      `startBridgeForTranscription(id)` (idempotent).
- [x] Join timeout: `requested/joining/awaiting_admission` older than
      `VEXA_JOIN_TIMEOUT_MS` (default 120000) without segments → status
      `rejected`, friendly error, tab-audio hint.
- [x] `instrumentation.js`: call `ensureVexaReconcileWorkerRunning()` +
      `ensureTranscriptionWorkerRunning()` on boot.

## 3. Preflight & UI
- [x] Meeting start: authenticated HEAD/status check against Vexa base URL
      + admin token before any transcription row or bot request; typed 503
      `VEXA_UNAVAILABLE` on failure. Covered by
      `tests/vexa-preflight.test.mjs`.
- [x] Status badges for the extended `bot_status` set + degraded/stale
      surfaced through the existing transcription-events timeline (de/en
      labels; `rejected` renders a clear error with a tab-audio CTA).

## 4. Definition of Done
- [x] Unit tests: backoff progression, stale detection, join-timeout
      mapping (pure helpers, no live Vexa needed) —
      `tests/vexa-bridge-utils.test.mjs` (19 tests).
- [ ] Manual: kill webapp mid-meeting → restart → live transcript
      resumes within one reconcile interval. Stop Vexa container →
      degraded banner appears, polling slows; start again → recovers.
      — NEEDS LIVE ENV: cannot be exercised in CI / this workspace; the
      code paths are covered by the unit suite and the build.
- [x] `npm test` + lint green; docs/vexa-integration troubleshooting
      section updated.
