# Tasks: Port Offline-First Mobile Field Mode

## 1. Service Worker

- [x] Port `public/sw.js`, `public/sw-policy.js`, `public/offline.html`.
- [x] Register the worker once, guarded by feature detection.
- [x] Confirm the manifest is linked and `display: standalone`.
- [x] Confirm API requests stay network-only.

## 2. Queue

- [x] Port `lib/offline-queue.js`.
- [x] Rename `DB_NAME` and `QUEUE_EVENT` to neutral upstream names.
- [x] Scope queued records by user and organization on read and replay.
- [x] Implement bounded backoff and a failed state past the bound.

## 3. Idempotency

- [x] Port `lib/capture-idempotency.js` and `capture-idempotency-core.js`.
- [x] Add nullable `transcriptions.client_capture_id`.
- [x] Add the scoped **partial** unique index.
- [x] Treat a duplicate id as success and return the existing record.

## 4. Capture Integration

- [x] Queue audio uploads when offline or on retryable failure.
- [x] Queue OCR uploads.
- [x] Queue photo captures with their selected fields.
- [x] Assign `clientCaptureId` at capture time, not upload time.
- [x] Show a "saved offline" confirmation instead of an error.

## 5. Status UI

- [x] Port `components/OfflineStatus.js`.
- [x] Render it from `components/Layout.js`.
- [x] Flush on the `online` event and via manual sync.
- [x] Refresh affected views after a successful flush.

## 6. i18n And Docs

- [x] Add offline/sync strings to `messages/de.json`.
- [x] Add the same keys to `messages/en.json`.
- [x] Document field-mode usage and iOS limits in `docs/`.

## 7. Verification

- [x] Port `tests/offline-queue.test.mjs` and
      `tests/mobile-field-idempotency.test.mjs`.
- [x] `npm run lint`.
- [x] `npm test`.
- [x] `npm run build`.
- [ ] PostgreSQL smoke: `initDatabase()` idempotent, column nullable,
      duplicate prevention scoped to org/user/capture.
- [ ] Manual: install the PWA, capture offline, reconnect, confirm exactly
      one record appears.
