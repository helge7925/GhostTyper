# Status: Port Mobile Field Mode

Last updated: 2026-08-11

## Current State

- **Implemented locally; live-device and PostgreSQL smoke remain.**
- Added network-only service-worker policy, scoped IndexedDB queue, bounded
  retries, capture-time UUIDs, duplicate-safe server handling, offline status,
  automatic/manual sync and affected-view refresh.

## Verified

- Offline queue and idempotency tests pass.
- `npm run lint`, `npm test` and `npm run build` pass.
- PWA manifest is linked and standalone mode is configured.

## Outstanding

- Disposable PostgreSQL smoke could not run: `TEST_DATABASE_URL` is unset and
  the local Docker daemon is unavailable.
- PWA install/capture/reconnect must be checked on a real device/browser.
