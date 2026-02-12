const LOG_LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const OBSERVABILITY_STATE_KEY = '__ghosttyperObservabilityState';

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
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code,
    };
  }
  if (typeof error === 'object') {
    return {
      message: error.message || 'Unknown error',
      code: error.code,
      stack: error.stack,
    };
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
  return normalized;
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
