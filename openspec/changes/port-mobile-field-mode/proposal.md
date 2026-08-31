# Change: Port Offline-First Mobile Field Mode From Downstream

## Why

GhostTyper has an installable `manifest.json` but no service worker, so it
is not actually offline-capable: every capture needs an immediate server
round-trip and a dropped connection loses the recording or upload. Anyone
capturing audio or photos away from a desk — a shop floor, a site visit, a
basement meeting room — hits this.

Downstream `romaco-scriptor` implemented the full offline path. The core
(`lib/offline-queue.js`, ~680 LOC with the surrounding modules) has only
**two customer-specific strings** (an IndexedDB name and an event name),
both trivially renameable.

The port also brings server-side upload idempotency, which is valuable on
its own: it prevents duplicate records when any upload is retried, offline
or not.

## Decisions Captured

- GhostTyper SHALL register a service worker and launch offline from a
  cached app shell.
- Captures made while offline SHALL be queued in IndexedDB rather than
  failing, scoped by user and organization.
- Queued captures SHALL survive reload and device restart.
- Queued captures SHALL upload automatically on reconnect, with bounded
  retry, and SHALL also be flushable manually.
- Replayed uploads SHALL be idempotent via a stable client capture id, so
  a retry cannot create a duplicate record.
- Connectivity and pending/syncing/failed state SHALL be visible.

## What Changes

- Port `public/sw.js`, `public/sw-policy.js`, `public/offline.html`.
- Port `lib/offline-queue.js`, `lib/capture-idempotency.js`,
  `lib/capture-idempotency-core.js`.
- Port `components/OfflineStatus.js` and render it in `components/Layout.js`.
- Rename the two downstream-specific constants to neutral names.
- Add nullable `transcriptions.client_capture_id` plus a scoped partial
  unique index on `(organization_id, user_id, client_capture_id)`.
- Integrate queueing into the audio upload, OCR upload and photo capture
  paths.

## Out Of Scope

- On-device transcription/OCR/AI — offline mode queues raw captures only;
  processing still runs server-side after upload.
- Background recording while the app is fully closed (web platform limit).
- Conflict resolution for concurrent multi-device edits.
- Treating IndexedDB as encrypted long-term storage; it stays a local
  browser cache.

## Success Criteria

- The app launches offline from the cached shell.
- A capture made with the network disabled survives a reload and uploads
  on reconnect.
- API requests are never served from cache.
- Replaying the same capture twice creates exactly one record.
- Users can see online/offline, pending, syncing and failed state.
