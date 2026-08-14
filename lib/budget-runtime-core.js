import crypto from 'crypto';
import { normalizeProviderUsage } from './pricing-core.js';

function stableValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value !== 'object') return `${typeof value}:${JSON.stringify(value)}`;
  if (Array.isArray(value)) return `array:[${value.map(stableValue).join(',')}]`;
  return `object:{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
}

// Backoff for a failing budget-stop event. The retry never terminates — the
// local job abort has already happened by the time a stop can fail, so what is
// left outstanding is a paid remote bot that would keep billing if abandoned.
// The delay only stops a permanently broken event from rewriting its row and
// logging twice a minute forever; escalation makes it visible instead.
export function stopRetryDelayMs(attempts, { baseMs = 30_000, maxMs = 900_000 } = {}) {
  const exponent = Math.max(0, Math.floor(Number(attempts) || 0) - 1);
  // Clamp the exponent before shifting so a runaway attempts value cannot
  // reach Infinity ahead of the cap.
  return Math.min(baseMs * 2 ** Math.min(exponent, 20), maxMs);
}

export function budgetIdempotencyKey(namespace, ...parts) {
  const label = String(namespace || 'paid').replace(/[^a-z0-9:_-]/gi, '-').slice(0, 70);
  const digest = crypto.createHash('sha256').update(parts.map(stableValue).join('\u001f')).digest('hex');
  return `${label}:${digest}`;
}

export function estimateTextUsage(text, {
  inputBufferTokens = 256,
  outputMultiplier = 1.25,
  outputBufferTokens = 256,
} = {}) {
  const chars = Array.from(String(text || '')).length;
  const baseTokens = Math.max(1, Math.ceil(chars / 3));
  return {
    inputQuantity: baseTokens + Math.max(0, Math.ceil(inputBufferTokens)),
    outputQuantity: Math.max(1, Math.ceil(baseTokens * outputMultiplier))
      + Math.max(0, Math.ceil(outputBufferTokens)),
  };
}

export function decideReservationDenial({
  amountMicros,
  workspaceRemainingMicros = null,
  memberRemainingMicros = null,
  stopOnDenied = false,
} = {}) {
  const amount = Number(amountMicros);
  const workspaceDenied = workspaceRemainingMicros !== null
    && amount > Number(workspaceRemainingMicros);
  const memberDenied = memberRemainingMicros !== null
    && amount > Number(memberRemainingMicros);
  if (!workspaceDenied && !memberDenied) return null;

  if (stopOnDenied && workspaceDenied && Number(workspaceRemainingMicros) === 0) {
    return { scope: 'workspace', availableMicros: 0, requestStop: true };
  }
  if (stopOnDenied && memberDenied && Number(memberRemainingMicros) === 0) {
    return { scope: 'member', availableMicros: 0, requestStop: true };
  }
  if (workspaceDenied) {
    return {
      scope: 'workspace',
      availableMicros: Number(workspaceRemainingMicros),
      requestStop: false,
    };
  }
  return {
    scope: 'member',
    availableMicros: Number(memberRemainingMicros),
    requestStop: false,
  };
}

export class BudgetCommitRetryExhaustedError extends Error {
  constructor(cause, attempts) {
    super('Budget usage commit retries were exhausted.');
    this.name = 'BudgetCommitRetryExhaustedError';
    this.code = 'BUDGET_COMMIT_RETRY_EXHAUSTED';
    this.cause = cause;
    this.attempts = attempts;
  }
}

export class BudgetCommitPendingError extends Error {
  constructor({ reservation = {}, reservationId = null, idempotencyKey, attempts = 0, cause = null,
    originalError = null, cancellation = null, accountingError = null, retryable = true } = {}) {
    super('Provider usage occurred, but its accounting commit is still pending. The reservation remains held.');
    this.name = 'BudgetCommitPendingError';
    // Preserve the established API availability response while exposing a
    // more specific machine-readable accounting state to internal callers.
    this.code = 'BUDGET_ACCOUNTING_UNAVAILABLE';
    this.accountingCode = 'BUDGET_COMMIT_PENDING';
    this.accountingState = 'reservation_held';
    this.reservationId = reservation.id ?? reservation.reservationId ?? reservationId;
    this.reservation = reservation;
    this.idempotencyKey = idempotencyKey;
    this.attempts = attempts;
    this.retryable = retryable;
    this.permanent = !retryable;
    this.commitFailureCode = cause?.code || null;
    this.originalError = originalError;
    this.cancellation = cancellation;
    this.accountingError = accountingError;
    this.cause = cause;
  }
}

export class BudgetProviderOutcomePendingError extends Error {
  constructor({ reservation = {}, idempotencyKey = null, cause = null, cancellation = null,
    accountingError = null } = {}) {
    super('The provider outcome is uncertain. Accounting remains pending and the reservation remains held.');
    this.name = 'BudgetProviderOutcomePendingError';
    this.code = 'BUDGET_ACCOUNTING_UNAVAILABLE';
    this.accountingCode = 'BUDGET_PROVIDER_OUTCOME_PENDING';
    this.accountingState = 'reservation_held';
    this.reservationId = reservation.id ?? reservation.reservationId ?? null;
    this.reservation = reservation;
    this.idempotencyKey = idempotencyKey;
    this.retryable = true;
    this.cancellation = cancellation;
    this.accountingError = accountingError;
    this.cause = cause || cancellation;
  }
}

export class BudgetProviderUsagePendingError extends Error {
  constructor({ reservation = {}, idempotencyKey = null, providerRequestId = null,
    cancellation = null, accountingError = null } = {}) {
    super('The provider completed successfully, but positive metered usage was not reported. Accounting remains pending.');
    this.name = 'BudgetProviderUsagePendingError';
    this.code = 'BUDGET_ACCOUNTING_UNAVAILABLE';
    this.accountingCode = 'BUDGET_PROVIDER_USAGE_PENDING';
    this.accountingState = 'reservation_held';
    this.reservationId = reservation.id ?? reservation.reservationId ?? null;
    this.reservation = reservation;
    this.idempotencyKey = idempotencyKey;
    this.providerRequestId = providerRequestId;
    this.retryable = true;
    this.cancellation = cancellation;
    this.accountingError = accountingError;
  }
}

export class BudgetReleasePendingError extends Error {
  constructor({ reservation = {}, idempotencyKey = null, attempts = 0, cause = null,
    originalError = null, accountingError = null } = {}) {
    super('A safe reservation release could not be confirmed. The reservation remains held.');
    this.name = 'BudgetReleasePendingError';
    this.code = 'BUDGET_ACCOUNTING_UNAVAILABLE';
    this.accountingCode = 'BUDGET_RELEASE_PENDING';
    this.accountingState = 'reservation_held';
    this.reservationId = reservation.id ?? reservation.reservationId ?? null;
    this.reservation = reservation;
    this.idempotencyKey = idempotencyKey;
    this.attempts = attempts;
    this.retryable = true;
    this.cause = cause;
    this.originalError = originalError;
    this.accountingError = accountingError;
  }
}

export function reservationMetadata(reservation = {}) {
  return {
    id: reservation.id ?? null,
    idempotencyKey: reservation.idempotency_key ?? reservation.idempotencyKey ?? null,
    organizationId: reservation.organization_id ?? reservation.organizationId ?? null,
    userId: reservation.user_id ?? reservation.userId ?? null,
    transcriptionId: reservation.transcription_id ?? reservation.transcriptionId ?? null,
    operation: reservation.operation ?? null,
    providerStartedAt: reservation.provider_started_at ?? reservation.providerStartedAt ?? null,
    accountingPendingAt: reservation.accounting_pending_at ?? reservation.accountingPendingAt ?? null,
  };
}

export function isExplicitNonBillableProviderError(error) {
  if (error?.providerOutcome === 'non_billable' || error?.providerNonBillable === true) return true;
  const status = Number(error?.status ?? error?.response?.status);
  return Number.isInteger(status) && status >= 400 && status < 500 && status !== 408;
}

export function hasPositiveMeteredUsage(usage = {}) {
  const quantities = normalizeProviderUsage(usage);
  return quantities.inputQuantity > 0 || quantities.outputQuantity > 0;
}

export function budgetPeriodKey(value = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function isCurrentBudgetPeriod(periodStart, now = new Date()) {
  const period = periodStart instanceof Date
    ? budgetPeriodKey(periodStart)
    : String(periodStart || '').slice(0, 10);
  return period === budgetPeriodKey(now);
}

export function planMeetingCheckpoint({ observedSeconds, accountedSeconds, final = false } = {}) {
  const observed = Math.max(0, Math.ceil(Number(observedSeconds) || 0));
  const accounted = Math.max(0, Math.floor(Number(accountedSeconds) || 0));
  const checkpoint = final ? observed : Math.floor(observed / 30) * 30;
  const ranges = [];
  let cursor = accounted;
  while (cursor < checkpoint) {
    const reservationEnd = cursor + 30;
    const usageEnd = Math.min(reservationEnd, checkpoint);
    ranges.push({ start: cursor, reservationEnd, usageEnd });
    cursor = usageEnd;
  }
  return {
    observed,
    accounted,
    checkpoint,
    ranges,
    speculativeStart: cursor,
  };
}

export async function retryTransientBudgetCommit(commit, {
  maxAttempts = 3,
  baseDelayMs = 50,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
} = {}) {
  if (typeof commit !== 'function') throw new TypeError('commit callback is required.');
  const attempts = Math.max(1, Math.min(10, Math.floor(Number(maxAttempts) || 1)));
  const delay = Math.max(0, Math.floor(Number(baseDelayMs) || 0));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await commit();
    } catch (error) {
      if (error?.code !== 'BUDGET_ACCOUNTING_UNAVAILABLE') throw error;
      if (attempt === attempts) throw new BudgetCommitRetryExhaustedError(error, attempt);
      // eslint-disable-next-line no-await-in-loop
      await sleep(delay * (2 ** (attempt - 1)));
    }
  }
  throw new BudgetCommitRetryExhaustedError(null, attempts);
}
