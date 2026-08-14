import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBackoffInterval,
  decideStale,
  decideJoinTimeout,
  isEarlyBotStatus,
  vexaReportsActive,
  POLL_BACKOFF_CAP_MS,
  DEGRADED_FAILURE_THRESHOLD,
} from '../lib/vexa-bridge-utils.js';

// --- Backoff ---------------------------------------------------------------

test('computeBackoffInterval: 0 failures returns the base cadence unchanged', () => {
  assert.equal(computeBackoffInterval(0, 2_000), 2_000);
  assert.equal(computeBackoffInterval(0, 500), 500);
});

test('computeBackoffInterval: doubles per consecutive failure', () => {
  // base 2s: 2s → 4s → 8s → 16s → 32s → (64s capped to 60s)
  assert.equal(computeBackoffInterval(1, 2_000), 4_000);
  assert.equal(computeBackoffInterval(2, 2_000), 8_000);
  assert.equal(computeBackoffInterval(3, 2_000), 16_000);
  assert.equal(computeBackoffInterval(4, 2_000), 32_000);
});

test('computeBackoffInterval: caps at 60s no matter how high the streak', () => {
  assert.equal(computeBackoffInterval(5, 2_000), POLL_BACKOFF_CAP_MS); // 64s → 60s
  assert.equal(computeBackoffInterval(6, 2_000), POLL_BACKOFF_CAP_MS);
  assert.equal(computeBackoffInterval(10, 2_000), POLL_BACKOFF_CAP_MS);
  assert.equal(computeBackoffInterval(1_000, 2_000), POLL_BACKOFF_CAP_MS); // no overflow
});

test('computeBackoffInterval: 500ms translation cadence also caps at 60s', () => {
  // 500ms base: 500 → 1000 → 2000 → ... → 60s cap at failures=7 (64s)
  assert.equal(computeBackoffInterval(0, 500), 500);
  assert.equal(computeBackoffInterval(1, 500), 1_000);
  assert.equal(computeBackoffInterval(7, 500), POLL_BACKOFF_CAP_MS); // 64s → 60s
  assert.equal(computeBackoffInterval(20, 500), POLL_BACKOFF_CAP_MS);
});

test('computeBackoffInterval: a success (failures reset to 0) restores base cadence', () => {
  // Simulate a streak that then recovers.
  assert.equal(computeBackoffInterval(4, 2_000), 32_000);
  assert.equal(computeBackoffInterval(0, 2_000), 2_000); // reset on success
});

test('DEGRADED_FAILURE_THRESHOLD is 10 (one-shot degraded event boundary)', () => {
  assert.equal(DEGRADED_FAILURE_THRESHOLD, 10);
});

// --- Stale detector --------------------------------------------------------

test('decideStale: no segment ever produced -> never stale (join-timeout path)', () => {
  assert.equal(
    decideStale({ lastSegmentAt: null, nowMs: 10_000_000, staleAfterMs: 180_000, alreadyWarned: false }),
    false,
  );
  assert.equal(
    decideStale({ lastSegmentAt: undefined, nowMs: 10_000_000, staleAfterMs: 180_000, alreadyWarned: false }),
    false,
  );
});

test('decideStale: does not fire before the threshold elapses', () => {
  const now = 1_000_000;
  // last segment 2 minutes ago, threshold 3 minutes -> not yet stale
  assert.equal(
    decideStale({ lastSegmentAt: now - 120_000, nowMs: now, staleAfterMs: 180_000, alreadyWarned: false }),
    false,
  );
});

test('decideStale: fires once the threshold is exceeded', () => {
  const now = 1_000_000;
  // last segment 4 minutes ago, threshold 3 minutes -> stale
  assert.equal(
    decideStale({ lastSegmentAt: now - 240_000, nowMs: now, staleAfterMs: 180_000, alreadyWarned: false }),
    true,
  );
});

test('decideStale: only once — alreadyWarned suppresses repeats', () => {
  const now = 1_000_000;
  assert.equal(
    decideStale({ lastSegmentAt: now - 600_000, nowMs: now, staleAfterMs: 180_000, alreadyWarned: true }),
    false,
  );
});

test('decideStale: exactly at the threshold is not yet stale (strict greater-than)', () => {
  const now = 1_000_000;
  assert.equal(
    decideStale({ lastSegmentAt: now - 180_000, nowMs: now, staleAfterMs: 180_000, alreadyWarned: false }),
    false,
  );
});

// --- Join-timeout decision -------------------------------------------------

const EARLY = 'awaiting_admission';

test('decideJoinTimeout: early state, past window, no segments, Vexa not active -> reject', () => {
  const now = 1_000_000;
  assert.equal(
    decideJoinTimeout({
      botStatus: EARLY,
      createdAtMs: now - 130_000, // 130s ago, timeout 120s
      nowMs: now,
      hasSegments: false,
      vexaActive: false,
      joinTimeoutMs: 120_000,
    }),
    true,
  );
});

test('decideJoinTimeout: still within the join window -> do not reject', () => {
  const now = 1_000_000;
  assert.equal(
    decideJoinTimeout({
      botStatus: 'requested',
      createdAtMs: now - 60_000, // only 60s ago
      nowMs: now,
      hasSegments: false,
      vexaActive: false,
      joinTimeoutMs: 120_000,
    }),
    false,
  );
});

test('decideJoinTimeout: segments already produced -> never reject (bot is admitted)', () => {
  const now = 1_000_000;
  assert.equal(
    decideJoinTimeout({
      botStatus: 'requested',
      createdAtMs: now - 600_000,
      nowMs: now,
      hasSegments: true,
      vexaActive: false,
      joinTimeoutMs: 120_000,
    }),
    false,
  );
});

test('decideJoinTimeout: Vexa reports the bot active (silent but present) -> do not reject', () => {
  const now = 1_000_000;
  assert.equal(
    decideJoinTimeout({
      botStatus: 'requested',
      createdAtMs: now - 600_000,
      nowMs: now,
      hasSegments: false,
      vexaActive: true, // bot is in the room, just no speech yet
      joinTimeoutMs: 120_000,
    }),
    false,
  );
});

test('decideJoinTimeout: non-early bot status (active) is never rejected on timeout', () => {
  const now = 1_000_000;
  assert.equal(
    decideJoinTimeout({
      botStatus: 'active',
      createdAtMs: now - 600_000,
      nowMs: now,
      hasSegments: false,
      vexaActive: false,
      joinTimeoutMs: 120_000,
    }),
    false,
  );
});

test('decideJoinTimeout: all three early states qualify past the window', () => {
  const now = 1_000_000;
  for (const status of ['requested', 'joining', 'awaiting_admission']) {
    assert.equal(
      decideJoinTimeout({
        botStatus: status,
        createdAtMs: now - 200_000,
        nowMs: now,
        hasSegments: false,
        vexaActive: false,
        joinTimeoutMs: 120_000,
      }),
      true,
      `status=${status} should reject past the window`,
    );
  }
});

// --- Small predicate helpers ----------------------------------------------

test('isEarlyBotStatus: recognises early states, case-insensitive', () => {
  assert.equal(isEarlyBotStatus('requested'), true);
  assert.equal(isEarlyBotStatus('JOINING'), true);
  assert.equal(isEarlyBotStatus('awaiting_admission'), true);
  assert.equal(isEarlyBotStatus('active'), false);
  assert.equal(isEarlyBotStatus('rejected'), false);
  assert.equal(isEarlyBotStatus(null), false);
  assert.equal(isEarlyBotStatus(undefined), false);
});

test('vexaReportsActive: active-ish meeting statuses only', () => {
  assert.equal(vexaReportsActive('active'), true);
  assert.equal(vexaReportsActive('Recording'), true);
  assert.equal(vexaReportsActive('requested'), false);
  assert.equal(vexaReportsActive('awaiting_admission'), false);
  assert.equal(vexaReportsActive('completed'), false);
  assert.equal(vexaReportsActive(null), false);
});
