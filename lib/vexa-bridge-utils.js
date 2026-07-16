/**
 * Pure, dependency-free decision helpers for the Vexa bridge + reconcile
 * worker.
 *
 * Deliberately import-free: the unit suite (tests/vexa-bridge-utils.test.mjs)
 * exercises backoff / stale / join-timeout logic without dragging in the DB
 * pool, axios or the AI stack that `lib/vexa-bridge.js` pulls at import time.
 */

// Poll backoff cap. Consecutive poll failures widen the next interval
// exponentially (base * 2^failures) up to this ceiling so a Vexa outage
// stops hammering the endpoint. A successful poll resets the counter and
// the base cadence returns.
export const POLL_BACKOFF_CAP_MS = 60_000;

// After this many *consecutive* poll failures we surface exactly one
// `vexa_degraded` event. Re-emitted only after an intervening success
// (a success→failure transition), never every tick.
export const DEGRADED_FAILURE_THRESHOLD = 10;

/**
 * Next poll interval given the consecutive-failure count.
 *   failures 0 → base (healthy cadence, unchanged)
 *   failures n → min(base * 2^n, cap)
 */
export function computeBackoffInterval(failures, baseIntervalMs, capMs = POLL_BACKOFF_CAP_MS) {
  const n = Number.isFinite(failures) && failures > 0 ? Math.floor(failures) : 0;
  const base = Number.isFinite(baseIntervalMs) && baseIntervalMs > 0 ? baseIntervalMs : 0;
  const cap = Number.isFinite(capMs) && capMs > 0 ? capMs : Infinity;
  // Clamp the exponent: anything past the cap is identical, and 2^large
  // would overflow to Infinity.
  const exp = Math.min(n, 30);
  const scaled = base * 2 ** exp;
  return Math.min(scaled, cap);
}

// Early bot-lifecycle states: requested but not yet confirmed "in the room
// and producing audio". A row stuck in one of these past the join timeout
// with zero segments is treated as never-admitted (→ rejected).
export const EARLY_BOT_STATES = new Set(['requested', 'joining', 'awaiting_admission']);

export function isEarlyBotStatus(botStatus) {
  return EARLY_BOT_STATES.has(String(botStatus || '').toLowerCase());
}

// Vexa meeting statuses that mean "the bot really is in the meeting"
// (admitted, recording) even when no speech has been transcribed yet.
// When Vexa reports one of these we must NOT reject on join-timeout: the
// bot is present, the room is merely silent. Terminal states
// (completed/failed) are handled on their own paths.
export const VEXA_ACTIVE_MEETING_STATES = new Set([
  'active', 'in_progress', 'recording', 'up', 'joined', 'started', 'live',
]);

export function vexaReportsActive(meetingStatus) {
  return VEXA_ACTIVE_MEETING_STATES.has(String(meetingStatus || '').toLowerCase());
}

/**
 * Decide whether a still-open meeting row should be marked `rejected`
 * (the bot was never admitted). Pure so it is unit-testable against
 * timestamps.
 *
 * Conservative by design — returns true ONLY when every signal agrees the
 * bot never got in:
 *   - no segment has ever been produced,
 *   - the bot is still in an early lifecycle state,
 *   - Vexa itself does not report the bot as actively in the meeting,
 *   - and the full join window has elapsed since the row was created.
 * A silent-but-present bot (Vexa status 'active', no speech yet) is never
 * rejected.
 */
export function decideJoinTimeout({
  botStatus,
  createdAtMs,
  nowMs,
  hasSegments,
  vexaActive,
  joinTimeoutMs,
}) {
  if (hasSegments) return false;
  if (!isEarlyBotStatus(botStatus)) return false;
  if (vexaActive) return false;
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs)) return false;
  const timeout = Number.isFinite(joinTimeoutMs) && joinTimeoutMs > 0 ? joinTimeoutMs : 0;
  return nowMs - createdAtMs > timeout;
}

/**
 * Decide whether to emit a one-shot `vexa_stale` warning.
 *
 * Fires when the bot has been producing segments (so it is admitted —
 * `lastSegmentAt` is set) but nothing new has arrived for `staleAfterMs`.
 * `alreadyWarned` suppresses repeats until a fresh segment clears the flag.
 * Returns false when no segment has ever arrived: that is the join-timeout
 * path, not staleness.
 */
export function decideStale({ lastSegmentAt, nowMs, staleAfterMs, alreadyWarned }) {
  if (alreadyWarned) return false;
  if (!Number.isFinite(lastSegmentAt)) return false;
  if (!Number.isFinite(nowMs)) return false;
  const threshold = Number.isFinite(staleAfterMs) && staleAfterMs > 0 ? staleAfterMs : 0;
  return nowMs - lastSegmentAt > threshold;
}
