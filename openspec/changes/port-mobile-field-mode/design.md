# Design: Port Offline-First Mobile Field Mode

## Source

Downstream `romaco-scriptor`:

- `public/sw.js`, `public/sw-policy.js`, `public/offline.html`
- `lib/offline-queue.js`, `lib/capture-idempotency.js`,
  `lib/capture-idempotency-core.js`
- `components/OfflineStatus.js`, rendered from `components/Layout.js`
- Tests: `offline-queue.test.mjs`, `mobile-field-idempotency.test.mjs`

## Renaming

`lib/offline-queue.js` carries the only customer coupling in the set:

```
const DB_NAME     = 'romaco-scriptor-field-mode';
const QUEUE_EVENT = 'romaco:offline-queue-change';
```

Rename to neutral upstream names (e.g. `ghosttyper-field-mode`,
`ghosttyper:offline-queue-change`). Nothing else in the ported modules
references the downstream product.

## Service Worker Policy

`sw-policy.js` separates cache policy from the worker itself:

- App shell: static precache, so the app boots offline.
- API routes: **network-only**, never cached. Caching authenticated API
  responses would leak data across sessions and serve stale state.
- Navigation: fall back to `offline.html` when the route is not cached.

## Queue

IndexedDB store of pending captures: blob, filename, target endpoint,
extra form fields, `clientCaptureId`, attempt count, last error, and the
owning user/organization. Records are filtered by the active user and
organization on read, so switching accounts never replays someone else's
capture.

Retry uses bounded exponential backoff; records past the bound surface as
failed rather than retrying forever.

## Server-Side Idempotency

Additive and nullable:

```
ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS client_capture_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_transcriptions_client_capture
  ON transcriptions(organization_id, user_id, client_capture_id)
  WHERE client_capture_id IS NOT NULL;
```

A *partial* unique index is required: without the `WHERE` clause, existing
rows with `NULL` would collide under some configurations, and the column
must stay nullable so normal online uploads are unaffected.

The upload path treats a duplicate `client_capture_id` as success and
returns the existing record, so a replay is indistinguishable from a
first-time success to the client.

## Capture Integration

Audio upload, OCR upload and photo capture try a normal upload first, and
fall back to `enqueue()` when offline or on a retryable failure. Each
capture is assigned a stable `clientCaptureId` at creation, not at upload,
so retries reuse it.

## Files Changed

- `public/sw.js`, `public/sw-policy.js`, `public/offline.html` (new)
- `lib/offline-queue.js`, `lib/capture-idempotency.js`,
  `lib/capture-idempotency-core.js` (new)
- `components/OfflineStatus.js` (new), `components/Layout.js`
- `lib/db-init.js` (nullable column + partial unique index)
- audio upload / OCR / photo capture call sites and their API routes
- `messages/de.json`, `messages/en.json`
- `tests/offline-queue.test.mjs`, `tests/mobile-field-idempotency.test.mjs`

## Risks

- Touches `lib/db-init.js`, as do `port-budget-runtime` and
  `port-audit-chain`.
- The downstream change still has its **manual real-device PWA test
  outstanding**; this port inherits that unverified assumption. Automated
  tests cover the queue and idempotency, not real browser eviction
  behaviour.
- iOS Safari limits background work, Wake Lock and storage retention;
  document this rather than promising parity with Android Chrome.
