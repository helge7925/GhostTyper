// Concurrency + budget guards for the public /api/share/[token]/* endpoints
// (H8 of cybersecurity-audit-2026-05-09). The audit flagged that the only
// existing limiter on those endpoints was a per-token rate-limit of 10
// requests / 60 s; nothing capped *concurrent* long-lived TTS streams or the
// total Mistral cost an anonymous visitor could push onto the row owner. A
// single attacker could open 10 simultaneous 4 h streams and walk the
// workspace's monthly budget straight to zero.
//
// What this module enforces:
//
//   - acquireStreamSlot(token, kind, max) — in-process Map keyed by
//     `${kind}:${token16}`. Returns a release function on success, or throws
//     SHARE_CONCURRENCY_LIMIT (HTTP 429) once `max` slots are held. Per
//     instance only — multi-replica deploys see `max * replicas` total, but
//     that is still bounded and the audit's "max 3 simultaneous streams per
//     token" is met for any single front-end node, which is what the
//     attacker actually targets.
//
//   - assertOrgTtsShareBudget(orgId, dailyMinutes) — sums today's
//     usage_log.input_tokens (= audio seconds, see lib/usage.js note on
//     voxtral-tts-latest) for `operation = 'live_tts_share'` and refuses
//     new streams once the org has consumed its daily cap. Default
//     LIVE_TTS_SHARE_DAILY_MINUTES_PER_ORG = 60 minutes.

// `query` is loaded lazily so the slot-counting helpers (which have no DB
// dependency) stay testable without pulling the full pg pool into the
// import graph.
let _query = null;
async function getQuery() {
  if (!_query) {
    const mod = await import('./db.js');
    _query = mod.query;
  }
  return _query;
}

const slotsByKey = new Map();

function makeKey(kind, token) {
  const safeToken = String(token || '').slice(0, 16);
  return `${kind}:${safeToken}`;
}

export class ShareConcurrencyLimitError extends Error {
  constructor(kind, max) {
    super(`Concurrency limit reached for share ${kind} (max ${max})`);
    this.name = 'ShareConcurrencyLimitError';
    this.code = 'SHARE_CONCURRENCY_LIMIT';
  }
}

export class ShareDailyBudgetError extends Error {
  constructor(usedSeconds, limitSeconds) {
    super(`Daily live_tts_share budget exhausted (${usedSeconds}/${limitSeconds} s)`);
    this.name = 'ShareDailyBudgetError';
    this.code = 'SHARE_DAILY_BUDGET_EXHAUSTED';
    this.usedSeconds = usedSeconds;
    this.limitSeconds = limitSeconds;
  }
}

export function acquireStreamSlot(token, kind = 'audio', max = 3) {
  const key = makeKey(kind, token);
  const current = slotsByKey.get(key) || 0;
  if (current >= max) {
    throw new ShareConcurrencyLimitError(kind, max);
  }
  slotsByKey.set(key, current + 1);
  let released = false;
  return function release() {
    if (released) return;
    released = true;
    const value = (slotsByKey.get(key) || 1) - 1;
    if (value <= 0) slotsByKey.delete(key);
    else slotsByKey.set(key, value);
  };
}

export function getCurrentSlotCount(token, kind = 'audio') {
  return slotsByKey.get(makeKey(kind, token)) || 0;
}

function resolveDailyLimitSeconds() {
  const fromEnv = Number.parseInt(process.env.LIVE_TTS_SHARE_DAILY_MINUTES_PER_ORG, 10);
  const minutes = Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 60;
  return minutes * 60;
}

export async function assertOrgTtsShareBudget(organizationId, options = {}) {
  if (!organizationId) return;
  const limitSeconds = options.limitSeconds ?? resolveDailyLimitSeconds();
  if (!Number.isFinite(limitSeconds) || limitSeconds <= 0) return;

  let used = 0;
  try {
    const query = await getQuery();
    const result = await query(
      `SELECT COALESCE(SUM(input_tokens), 0)::bigint AS used_seconds
         FROM usage_log
        WHERE organization_id = $1
          AND operation = 'live_tts_share'
          AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
      [organizationId],
    );
    used = Number(result.rows[0]?.used_seconds || 0);
  } catch {
    // DB unavailable — fail open on the budget check so we don't lose the
    // primary stream functionality, but the concurrency cap above still
    // bounds the worst case.
    return;
  }

  if (used >= limitSeconds) {
    throw new ShareDailyBudgetError(used, limitSeconds);
  }
}
