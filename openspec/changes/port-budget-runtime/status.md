# Status: Port Budget Runtime And Pricing Engine

Last updated: 2026-08-11

## Current State

- **Implemented locally; PostgreSQL concurrency smoke remains.**
- Added versioned provider pricing, organization overrides, member/workspace
  budgets, reservations, durable stop outbox with backoff/escalation, live
  usage/progress APIs, enforcement across paid provider paths and admin UI.

## Verified

- Budget/pricing/runtime/live-progress tests pass.
- Full suite: 368 tests, 356 passed, 12 environment-dependent skips, 0 failed.
- `npm run lint` and `npm run build` pass.

## Outstanding

- Real row-lock, expiry and lifecycle tests are present under `tests/db/` but
  skip safely because `TEST_DATABASE_URL` is unset. Docker is not running
  locally, so no disposable PostgreSQL instance could be started.
