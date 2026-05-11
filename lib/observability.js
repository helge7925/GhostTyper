import crypto from 'node:crypto';

const LOG_LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const OBSERVABILITY_STATE_KEY = '__ghosttyperObservabilityState';

// M8 (cybersecurity-audit-2026-05-09): production logs and audit
// metadata previously stored full stack traces and plaintext email
// addresses, both of which are PII under GDPR Art. 4 #1 and surface in
// log aggregators / SIEMs that may have a different retention regime
// than the application database.
//
// Redaction policy:
//   - LOG_REDACT_PII=true (default in production, opt-out)
//   - Email-shaped strings are replaced with email:sha256:<10 hex>
//   - Keys matching SENSITIVE_KEY_PATTERN have their value blanked
//   - Errors no longer include stack traces in production unless
//     LOG_INCLUDE_STACK=true is set explicitly.
const SENSITIVE_KEY_PATTERN = /(password|secret|token|api[_-]?key|authorization|cookie)/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REDACT_DEPTH_LIMIT = 6;

function shouldRedactPii() {
  const explicit = process.env.LOG_REDACT_PII;
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

function shouldIncludeStack() {
  if (process.env.LOG_INCLUDE_STACK === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

export function pseudonymizeEmail(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const digest = crypto.createHash('sha256').update(trimmed).digest('hex');
  return `email:sha256:${digest.slice(0, 10)}`;
}

function redactValue(value, depth) {
  if (depth > REDACT_DEPTH_LIMIT) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (EMAIL_PATTERN.test(value)) return pseudonymizeEmail(value);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[redacted]';
        continue;
      }
      if (/email/i.test(k) && typeof v === 'string') {
        out[k] = pseudonymizeEmail(v) || '[redacted]';
        continue;
      }
      out[k] = redactValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

function normalizeLevel(level) {
  const normalized = typeof level === 'string' ? level.toLowerCase() : 'info';
  if (LOG_LEVEL_ORDER[normalized]) return normalized;
  return 'info';
}

function getMinLogLevel() {
  const defaultLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug';
  return normalizeLevel(process.env.LOG_LEVEL || defaultLevel);
}

function getLogFormat() {
  const format = (process.env.LOG_FORMAT || 'json').toLowerCase();
  return format === 'plain' ? 'plain' : 'json';
}

function shouldLog(level) {
  const normalizedLevel = normalizeLevel(level);
  const minLevel = getMinLogLevel();
  return LOG_LEVEL_ORDER[normalizedLevel] >= LOG_LEVEL_ORDER[minLevel];
}

function serializeError(error) {
  if (!error) return null;
  if (typeof error === 'string') return { message: error };
  const includeStack = shouldIncludeStack();
  if (error instanceof Error) {
    const out = {
      name: error.name,
      message: error.message,
      code: error.code,
    };
    if (includeStack) out.stack = error.stack;
    return out;
  }
  if (typeof error === 'object') {
    const out = {
      message: error.message || 'Unknown error',
      code: error.code,
    };
    if (includeStack) out.stack = error.stack;
    return out;
  }
  return { message: String(error) };
}

function normalizeDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};

  const normalized = {};
  Object.entries(details).forEach(([key, value]) => {
    if (value === undefined) return;
    if (typeof value === 'bigint') {
      normalized[key] = value.toString();
      return;
    }
    if (value instanceof Error) {
      normalized[key] = serializeError(value);
      return;
    }
    normalized[key] = value;
  });
  return shouldRedactPii() ? redactValue(normalized, 0) : normalized;
}

function getObservabilityState() {
  if (!globalThis[OBSERVABILITY_STATE_KEY]) {
    globalThis[OBSERVABILITY_STATE_KEY] = {
      startedAtMs: Date.now(),
      counters: {
        jobsQueued: 0,
        jobsStarted: 0,
        jobsCompleted: 0,
        jobsFailed: 0,
        staleRecovered: 0,
        workerScans: 0,
        dbSlowQueries: 0,
        dbQueryErrors: 0,
        securityEvents: 0,
      },
      worker: {
        running: false,
        concurrency: null,
        scanIntervalMs: null,
        queueDepth: 0,
        activeJobs: 0,
        lastQueuedAt: null,
        lastStartedAt: null,
        lastCompletedAt: null,
        lastFailedAt: null,
        lastFailureMessage: null,
        lastScanAt: null,
        lastScanFound: 0,
      },
      db: {
        lastSlowQueryAt: null,
        lastSlowQueryDurationMs: null,
        lastSlowQueryRows: null,
        lastQueryErrorAt: null,
      },
    };
  }

  return globalThis[OBSERVABILITY_STATE_KEY];
}

function emit(level, payload) {
  const format = getLogFormat();
  const line = format === 'json'
    ? JSON.stringify(payload)
    : `[${payload.timestamp}] ${payload.level.toUpperCase()} ${payload.event} ${JSON.stringify(payload.details || {})}`;

  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  if (level === 'debug') {
    console.debug(line);
    return;
  }
  console.log(line);
}

export function logEvent(level, event, details = {}) {
  const normalizedLevel = normalizeLevel(level);
  if (!shouldLog(normalizedLevel)) return;

  emit(normalizedLevel, {
    timestamp: new Date().toISOString(),
    level: normalizedLevel,
    event,
    details: normalizeDetails(details),
  });
}

export function logDebug(event, details = {}) {
  logEvent('debug', event, details);
}

export function logInfo(event, details = {}) {
  logEvent('info', event, details);
}

export function logWarn(event, details = {}) {
  logEvent('warn', event, details);
}

export function logError(event, error = null, details = {}) {
  const payload = normalizeDetails(details);
  const serializedError = serializeError(error);
  if (serializedError) payload.error = serializedError;
  logEvent('error', event, payload);
}

export function updateWorkerMetrics(partial = {}) {
  const state = getObservabilityState();
  Object.assign(state.worker, normalizeDetails(partial));
}

export function trackWorkerScan(found = 0) {
  const state = getObservabilityState();
  state.counters.workerScans += 1;
  state.worker.lastScanAt = new Date().toISOString();
  state.worker.lastScanFound = Number.isFinite(found) ? Number(found) : 0;
}

export function trackJobQueued() {
  const state = getObservabilityState();
  state.counters.jobsQueued += 1;
  state.worker.lastQueuedAt = new Date().toISOString();
}

export function trackJobStarted() {
  const state = getObservabilityState();
  state.counters.jobsStarted += 1;
  state.worker.lastStartedAt = new Date().toISOString();
}

export function trackJobCompleted() {
  const state = getObservabilityState();
  state.counters.jobsCompleted += 1;
  state.worker.lastCompletedAt = new Date().toISOString();
}

export function trackJobFailed(message = null) {
  const state = getObservabilityState();
  state.counters.jobsFailed += 1;
  state.worker.lastFailedAt = new Date().toISOString();
  if (message) state.worker.lastFailureMessage = String(message);
}

export function trackStaleRecovery(amount = 1) {
  const state = getObservabilityState();
  const safeAmount = Number.isFinite(amount) ? Math.max(0, Number(amount)) : 0;
  if (!safeAmount) return;
  state.counters.staleRecovered += safeAmount;
}

export function trackDbSlowQuery(durationMs, rowCount) {
  const state = getObservabilityState();
  state.counters.dbSlowQueries += 1;
  state.db.lastSlowQueryAt = new Date().toISOString();
  state.db.lastSlowQueryDurationMs = Number.isFinite(durationMs) ? Number(durationMs) : null;
  state.db.lastSlowQueryRows = Number.isFinite(rowCount) ? Number(rowCount) : null;
}

export function trackDbQueryError() {
  const state = getObservabilityState();
  state.counters.dbQueryErrors += 1;
  state.db.lastQueryErrorAt = new Date().toISOString();
}

export function trackSecurityEvent(event, details = {}) {
  const state = getObservabilityState();
  state.counters.securityEvents += 1;
  logWarn(`security.${String(event || 'event')}`, details);
}

export function getObservabilitySnapshot() {
  const state = getObservabilityState();
  return {
    timestamp: new Date().toISOString(),
    startedAt: new Date(state.startedAtMs).toISOString(),
    uptimeSeconds: Math.max(0, Math.floor((Date.now() - state.startedAtMs) / 1000)),
    counters: { ...state.counters },
    worker: { ...state.worker },
    db: { ...state.db },
  };
}
