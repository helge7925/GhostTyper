// Per-email account lockout (M4, cybersecurity-audit-2026-05-09).
//
// The existing rate-limit on /api/auth/* is per-IP, which a distributed
// brute-force bypasses trivially. This module adds a second, per-email
// counter with progressive lockout: after a configurable number of
// consecutive failures, login attempts for that email are refused for a
// growing window regardless of source IP.
//
// Tunable via ENV:
//   LOGIN_LOCKOUT_THRESHOLD_LOW    (default 5)   — short cool-down
//   LOGIN_LOCKOUT_THRESHOLD_MID    (default 10)  — medium cool-down
//   LOGIN_LOCKOUT_THRESHOLD_HIGH   (default 25)  — long cool-down
//   LOGIN_LOCKOUT_WINDOW_LOW_MS    (default 30 s)
//   LOGIN_LOCKOUT_WINDOW_MID_MS    (default 5 min)
//   LOGIN_LOCKOUT_WINDOW_HIGH_MS   (default 30 min)
//
// A successful login resets the counter. Lockout-untils are advisory:
// once the timestamp has passed, the next attempt re-enters the
// counting window without resetting failure_count, so a sustained
// attacker stays escalated.

// `query` is loaded lazily so the pure helper computeLockoutMs stays
// testable with `node --test` without dragging the full pg pool into
// the import graph (db.js transitively imports observability without an
// .js extension, which raw-node ESM rejects).
let _query = null;
async function getQuery() {
  if (!_query) {
    const mod = await import('./db.js');
    _query = mod.query;
  }
  return _query;
}

function envInt(name, fallback) {
  const raw = Number.parseInt(process.env[name], 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

const THRESHOLD_LOW = envInt('LOGIN_LOCKOUT_THRESHOLD_LOW', 5);
const THRESHOLD_MID = envInt('LOGIN_LOCKOUT_THRESHOLD_MID', 10);
const THRESHOLD_HIGH = envInt('LOGIN_LOCKOUT_THRESHOLD_HIGH', 25);
const WINDOW_LOW_MS = envInt('LOGIN_LOCKOUT_WINDOW_LOW_MS', 30 * 1000);
const WINDOW_MID_MS = envInt('LOGIN_LOCKOUT_WINDOW_MID_MS', 5 * 60 * 1000);
const WINDOW_HIGH_MS = envInt('LOGIN_LOCKOUT_WINDOW_HIGH_MS', 30 * 60 * 1000);

export function computeLockoutMs(failureCount) {
  if (failureCount >= THRESHOLD_HIGH) return WINDOW_HIGH_MS;
  if (failureCount >= THRESHOLD_MID) return WINDOW_MID_MS;
  if (failureCount >= THRESHOLD_LOW) return WINDOW_LOW_MS;
  return 0;
}

export async function isEmailLockedOut(emailLower) {
  if (!emailLower) return { locked: false };
  try {
    const query = await getQuery();
    const result = await query(
      `SELECT failure_count, locked_until
         FROM login_attempts
        WHERE email_lower = $1`,
      [emailLower],
    );
    const row = result.rows[0];
    if (!row || !row.locked_until) return { locked: false, failureCount: row?.failure_count || 0 };
    const lockedUntil = new Date(row.locked_until);
    if (Number.isNaN(lockedUntil.valueOf())) return { locked: false };
    if (lockedUntil.valueOf() <= Date.now()) {
      return { locked: false, failureCount: row.failure_count || 0 };
    }
    return {
      locked: true,
      failureCount: row.failure_count || 0,
      lockedUntil,
    };
  } catch (error) {
    if (error?.code === '42P01') return { locked: false };
    throw error;
  }
}

export async function recordFailedLogin(emailLower) {
  if (!emailLower) return null;
  try {
    const query = await getQuery();
    const result = await query(
      `INSERT INTO login_attempts (email_lower, failure_count, last_failure_at, updated_at)
         VALUES ($1, 1, NOW(), NOW())
         ON CONFLICT (email_lower) DO UPDATE SET
           failure_count = login_attempts.failure_count + 1,
           last_failure_at = NOW(),
           updated_at = NOW()
         RETURNING failure_count`,
      [emailLower],
    );
    const failureCount = result.rows[0]?.failure_count || 1;
    const lockoutMs = computeLockoutMs(failureCount);
    if (lockoutMs > 0) {
      const queryFn = await getQuery();
      await queryFn(
        `UPDATE login_attempts
            SET locked_until = NOW() + ($2::int * INTERVAL '1 millisecond'),
                updated_at = NOW()
          WHERE email_lower = $1`,
        [emailLower, lockoutMs],
      );
    }
    return { failureCount, lockoutMs };
  } catch (error) {
    if (error?.code === '42P01') return null;
    throw error;
  }
}

export async function recordSuccessfulLogin(emailLower) {
  if (!emailLower) return;
  try {
    const query = await getQuery();
    await query(
      `DELETE FROM login_attempts WHERE email_lower = $1`,
      [emailLower],
    );
  } catch (error) {
    if (error?.code === '42P01') return;
    throw error;
  }
}

export const __testables = {
  THRESHOLD_LOW,
  THRESHOLD_MID,
  THRESHOLD_HIGH,
  WINDOW_LOW_MS,
  WINDOW_MID_MS,
  WINDOW_HIGH_MS,
};
