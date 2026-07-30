# Status: Port Offline-First Mobile Field Mode

Last updated: 2026-07-30

## Current State

- **Proposed — not started.**
- Upstream has `public/manifest.json` but no service worker, no offline
  queue, no capture idempotency and no connectivity indicator.

## Verified

- Not applicable yet (no implementation).

## Notes

- Only customer coupling downstream is two string constants in
  `lib/offline-queue.js`.
- The downstream change's manual real-device PWA test is still
  outstanding; this port inherits that unverified assumption.
- Conflicts with `port-budget-runtime` and `port-audit-chain` on
  `lib/db-init.js`.
