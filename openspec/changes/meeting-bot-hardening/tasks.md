# Tasks: Meeting-Bot Hardening

## 1. Bridge resilience
- [ ] Backoff per slot in `lib/vexa-bridge.js` (fail counter, ×2 to 60s
      cap, reset on success); `vexa_degraded` event after 10 fails.
- [ ] Stale detector: track `lastSegmentAt`; if bot active and no new
      segment for `VEXA_STALE_AFTER_MS` (default 180000) → warning
      event once, cleared on next segment.
- [ ] Export `isBridgeActive` (exists) + use in reconcile re-attach.

## 2. Recovery & lifecycle
- [ ] Reconcile tick: for active vexa rows without bridge →
      `startBridgeForTranscription(id)` (idempotent).
- [ ] Join timeout: `requested/joining/awaiting_admission` older than
      `VEXA_JOIN_TIMEOUT_MS` (default 120000) without segments → status
      `rejected`, friendly error, tab-audio hint.
- [ ] `instrumentation.js`: call `ensureVexaReconcileWorkerRunning()` +
      `ensureTranscriptionWorkerRunning()` on boot.

## 3. Preflight & UI
- [ ] Meeting start: HEAD/status check against Vexa base URL + admin
      token before bot request; typed 503 `VEXA_UNAVAILABLE` on failure.
- [ ] Status badges for the extended `bot_status` set + degraded/stale
      banners (i18n de/en).

## 4. Definition of Done
- [ ] Unit tests: backoff progression, stale detection, join-timeout
      mapping (pure helpers, no live Vexa needed).
- [ ] Manual: kill webapp mid-meeting → restart → live transcript
      resumes within one reconcile interval. Stop Vexa container →
      degraded banner appears, polling slows; start again → recovers.
- [ ] `npm test` + lint green; docs/vexa-integration troubleshooting
      section updated.
