# Tasks: Port Offline-First Mobile Field Mode

## 1. Service Worker

- [ ] Port `public/sw.js`, `public/sw-policy.js`, `public/offline.html`.
- [ ] Register the worker once, guarded by feature detection.
- [ ] Confirm the manifest is linked and `display: standalone`.
- [ ] Confirm API requests stay network-only.

## 2. Queue

- [ ] Port `lib/offline-queue.js`.
- [ ] Rename `DB_NAME` and `QUEUE_EVENT` to neutral upstream names.
- [ ] Scope queued records by user and organization on read and replay.
- [ ] Implement bounded backoff and a failed state past the bound.

## 3. Idempotency

- [ ] Port `lib/capture-idempotency.js` and `capture-idempotency-core.js`.
- [ ] Add nullable `transcriptions.client_capture_id`.
- [ ] Add the scoped **partial** unique index.
- [ ] Treat a duplicate id as success and return the existing record.

## 4. Capture Integration

- [ ] Queue audio uploads when offline or on retryable failure.
- [ ] Queue OCR uploads.
- [ ] Queue photo captures with their selected fields.
- [ ] Assign `clientCaptureId` at capture time, not upload time.
- [ ] Show a "saved offline" confirmation instead of an error.

## 5. Status UI

- [ ] Port `components/OfflineStatus.js`.
- [ ] Render it from `components/Layout.js`.
- [ ] Flush on the `online` event and via manual sync.
- [ ] Refresh affected views after a successful flush.

## 6. i18n And Docs

- [ ] Add offline/sync strings to `messages/de.json`.
- [ ] Add the same keys to `messages/en.json`.
- [ ] Document field-mode usage and iOS limits in `docs/`.

## 7. Verification

- [ ] Port `tests/offline-queue.test.mjs` and
      `tests/mobile-field-idempotency.test.mjs`.
- [ ] `npm run lint`.
- [ ] `npm test`.
- [ ] `npm run build`.
- [ ] PostgreSQL smoke: `initDatabase()` idempotent, column nullable,
      duplicate prevention scoped to org/user/capture.
- [ ] Manual: install the PWA, capture offline, reconnect, confirm exactly
      one record appears.
