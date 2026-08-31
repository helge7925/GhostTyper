# Capability: Offline-First Mobile Field Mode

## ADDED Requirements

### Requirement: Offline-Capable App Shell

GhostTyper SHALL register a service worker and launch offline from a
cached app shell.

#### Scenario: App launches without network

- **GIVEN** the app shell has been cached
- **WHEN** the user opens the app while offline
- **THEN** the app UI loads from cache instead of failing.

#### Scenario: API requests stay network-only

- **WHEN** the app issues an API request
- **THEN** the service worker does not serve it from cache.

#### Scenario: Offline navigation fallback

- **WHEN** the user navigates to an uncached route while offline
- **THEN** a dedicated offline page is shown.

### Requirement: Offline Capture Queue

GhostTyper SHALL queue captures made while offline, scoped by user and
organization.

#### Scenario: Audio recorded while offline

- **WHEN** the user finishes a recording with no connectivity
- **THEN** it is stored in the local queue and the user is told it will
  upload later, rather than shown an error.

#### Scenario: Photo or document captured while offline

- **WHEN** the user captures an image for OCR with no connectivity
- **THEN** the image and its selected fields are queued.

#### Scenario: Queue survives restart

- **GIVEN** captures are queued
- **WHEN** the app is reloaded or the device restarts
- **THEN** the queued captures are still pending.

#### Scenario: Queue is scoped

- **GIVEN** captures were queued by one user in one organization
- **WHEN** a different user or organization is active
- **THEN** those captures are not visible or replayed for them.

### Requirement: Automatic Sync With Bounded Retry

GhostTyper SHALL upload queued captures on reconnect, with bounded retry
and a manual flush.

#### Scenario: Connectivity returns

- **WHEN** the device regains connectivity
- **THEN** queued captures upload and, on success, leave the queue.

#### Scenario: Transient failure

- **WHEN** an upload fails with a retryable error
- **THEN** the capture stays queued with an incremented attempt count and
  is retried with bounded backoff.

#### Scenario: Manual sync

- **WHEN** the user triggers a manual sync
- **THEN** GhostTyper attempts to flush the queue immediately.

### Requirement: Idempotent Capture Replay

GhostTyper SHALL make replayed uploads idempotent via a stable client
capture id.

#### Scenario: Same capture uploaded twice

- **WHEN** the same queued capture is replayed more than once
- **THEN** exactly one record is created.

#### Scenario: Different users, same id

- **GIVEN** two different users submit the same client capture id
- **THEN** both records are created, because idempotency is scoped to
  organization and user.

### Requirement: Visible Connectivity And Sync State

GhostTyper SHALL show online/offline, pending, syncing and failed state.

#### Scenario: Pending captures exist

- **WHEN** captures are queued
- **THEN** an indicator shows connectivity, the pending count and a manual
  sync action.

#### Scenario: Sync failed

- **WHEN** the last sync attempt failed
- **THEN** the indicator surfaces the failure.
