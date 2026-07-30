# Status: Port Budget Runtime And Pricing Engine

Last updated: 2026-07-30

## Current State

- **Proposed — not started.**
- Upstream today has `lib/budget-guardrails.js` (pre-flight check) and
  `lib/usage.js` (after-the-fact recording) but no enforcement,
  reservations, versioned pricing, or stop worker.

## Verified

- Not applicable yet (no implementation).

## Notes

- Largest item of the downstream port set (~2,500 LOC + 6 tables).
- `lib/budget-core.js` has no customer-specific references downstream.
- Port the *fixed* stop-worker behaviour (backoff + escalation), not the
  original looping version.
- Conflicts with `port-audit-chain` and `port-mobile-field-mode` on
  `lib/db-init.js`.
