import { query } from './db';

const store = new Map();
let ensureRateLimitTablePromise = null;
let nextDbCleanupAt = 0;

function pruneStore(now) {
  if (store.size < 5000) return;
  for (const [key, value] of store.entries()) {
    if (now >= value.resetAt) {
      store.delete(key);
    }
  }
}

function shouldTrustProxy() {
  return process.env.RATE_LIMIT_TRUST_PROXY === 'true';
}

function getClientIp(req) {
  if (!req) return 'unknown';
  const remoteAddress = req.socket?.remoteAddress || 'unknown';
  if (!shouldTrustProxy()) {
    return remoteAddress;
  }

  const headers = req.headers || {};
  const xff = headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return remoteAddress;
}

function touchEntry(key, windowMs) {
  const now = Date.now();
  pruneStore(now);
  const existing = store.get(key);

  if (!existing || now >= existing.resetAt) {
    const resetAt = now + windowMs;
    const entry = { count: 0, resetAt };
    store.set(key, entry);
    return entry;
  }

  return existing;
}

function getStoreMode() {
  const configured = String(process.env.RATE_LIMIT_STORE || '').trim().toLowerCase();
  if (configured === 'db' || configured === 'memory') return configured;
  return process.env.NODE_ENV === 'production' ? 'db' : 'memory';
}

async function ensureRateLimitTable() {
  if (ensureRateLimitTablePromise) {
    return ensureRateLimitTablePromise;
  }

  ensureRateLimitTablePromise = (async () => {
    await query(
      `CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        reset_at TIMESTAMP WITH TIME ZONE NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )`
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at
       ON rate_limits(reset_at)`
    );
  })().catch((error) => {
    ensureRateLimitTablePromise = null;
    throw error;
  });

  return ensureRateLimitTablePromise;
}

async function maybeCleanupDbStore(now) {
  if (now < nextDbCleanupAt) return;
  nextDbCleanupAt = now + 60_000;
  await query(
    `DELETE FROM rate_limits
     WHERE reset_at < NOW() - interval '5 minutes'`
  );
}

async function checkRateLimitDb(req, options = {}) {
  const {
    keyPrefix = 'global',
    identifier,
    limit = 60,
    windowMs = 60_000,
  } = options;

  const id = identifier || getClientIp(req);
  const key = `${keyPrefix}:${id}`;
  const now = Date.now();

  await ensureRateLimitTable();

  const result = await query(
    `WITH upsert AS (
       INSERT INTO rate_limits (key, count, reset_at, updated_at)
       VALUES ($1, 1, NOW() + ($2::int * interval '1 millisecond'), NOW())
       ON CONFLICT (key) DO UPDATE
       SET
         count = CASE
           WHEN rate_limits.reset_at <= NOW() THEN 1
           ELSE rate_limits.count + 1
         END,
         reset_at = CASE
           WHEN rate_limits.reset_at <= NOW() THEN NOW() + ($2::int * interval '1 millisecond')
           ELSE rate_limits.reset_at
         END,
         updated_at = NOW()
       RETURNING count, reset_at
     )
     SELECT
       count,
       (EXTRACT(EPOCH FROM reset_at) * 1000)::bigint AS reset_at_ms
     FROM upsert`,
    [key, windowMs]
  );

  const row = result.rows[0] || {};
  const count = Number(row.count) || 0;
  const resetAtMs = Number(row.reset_at_ms) || (now + windowMs);
  const retryAfterMs = Math.max(0, resetAtMs - now);
  const remaining = Math.max(0, limit - count);

  await maybeCleanupDbStore(now).catch(() => {});

  return {
    allowed: count <= limit,
    remaining,
    retryAfterMs,
    limit,
  };
}

function checkRateLimitMemory(req, options = {}) {
  const {
    keyPrefix = 'global',
    identifier,
    limit = 60,
    windowMs = 60_000,
  } = options;

  const id = identifier || getClientIp(req);
  const key = `${keyPrefix}:${id}`;
  const entry = touchEntry(key, windowMs);
  entry.count += 1;

  const remaining = Math.max(0, limit - entry.count);
  const retryAfterMs = Math.max(0, entry.resetAt - Date.now());

  return {
    allowed: entry.count <= limit,
    remaining,
    retryAfterMs,
    limit,
  };
}

export async function checkRateLimit(req, options = {}) {
  const mode = getStoreMode();
  if (mode === 'db') {
    try {
      return await checkRateLimitDb(req, options);
    } catch {
      return checkRateLimitMemory(req, options);
    }
  }
  return checkRateLimitMemory(req, options);
}

export function applyRateLimitHeaders(res, rate) {
  res.setHeader('X-RateLimit-Limit', String(rate.limit));
  res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil((Date.now() + rate.retryAfterMs) / 1000)));
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(Math.ceil(rate.retryAfterMs / 1000)));
  }
}
