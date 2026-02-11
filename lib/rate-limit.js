const store = new Map();

function pruneStore(now) {
  if (store.size < 5000) return;
  for (const [key, value] of store.entries()) {
    if (now >= value.resetAt) {
      store.delete(key);
    }
  }
}

function getClientIp(req) {
  if (!req) return 'unknown';
  const headers = req.headers || {};
  const xff = headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
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

export function checkRateLimit(req, options = {}) {
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

export function applyRateLimitHeaders(res, rate) {
  res.setHeader('X-RateLimit-Limit', String(rate.limit));
  res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil((Date.now() + rate.retryAfterMs) / 1000)));
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(Math.ceil(rate.retryAfterMs / 1000)));
  }
}
