import crypto from 'crypto';
import { query } from './db';
import { calculateUsageCost, inferProviderForModel } from './pricing-core';
import { resolveProviderPrice } from './pricing-service';
import {
  BudgetAccountingUnavailableError,
  commitSpend,
  markAccountingPending,
  markProviderStarted,
  releaseSpend,
  releaseSpendByIdempotencyKey,
  reserveSpend,
} from './budget-service';
import {
  BudgetCommitPendingError,
  BudgetCommitRetryExhaustedError,
  BudgetProviderOutcomePendingError,
  BudgetProviderUsagePendingError,
  BudgetReleasePendingError,
  budgetIdempotencyKey,
  estimateTextUsage,
  hasPositiveMeteredUsage,
  isExplicitNonBillableProviderError,
  planMeetingCheckpoint,
  reservationMetadata,
  retryTransientBudgetCommit,
} from './budget-runtime-core';
import {
  abortBudgetExecutionsForScope,
  composeAbortSignals,
  PaidJobCancelledError,
  registerBudgetExecution,
  startAbortPolling,
} from './budget-cancellation';

export {
  BudgetCommitPendingError,
  BudgetProviderOutcomePendingError,
  BudgetProviderUsagePendingError,
  BudgetReleasePendingError,
  budgetIdempotencyKey,
  estimateTextUsage,
} from './budget-runtime-core';
export { composeAbortSignals, PaidJobCancelledError } from './budget-cancellation';

const DEFAULT_RESERVATION_MS = 15 * 60 * 1000;
const BUDGET_STOP_POLL_INTERVAL_MS = Math.max(
  100,
  Number(process.env.BUDGET_EXECUTION_STOP_POLL_INTERVAL_MS || 1_000),
);
const activeJobControllers = new Map();

async function retainAccountingPending(reservation) {
  try {
    return { reservation: await markAccountingPending(reservation.id), accountingError: null };
  } catch (accountingError) {
    return { reservation: null, accountingError };
  }
}

async function releaseKnownSafe(release, {
  reservation = {},
  idempotencyKey = null,
  originalError = null,
} = {}) {
  try {
    return await retryTransientBudgetCommit(release);
  } catch (error) {
    const exhausted = error instanceof BudgetCommitRetryExhaustedError;
    const pending = reservation.id
      ? await retainAccountingPending(reservation)
      : { reservation: null, accountingError: null };
    throw new BudgetReleasePendingError({
      reservation: reservationMetadata(pending.reservation || reservation),
      idempotencyKey,
      attempts: exhausted ? error.attempts : 1,
      cause: exhausted ? error.cause : error,
      originalError,
      accountingError: pending.accountingError,
    });
  }
}

async function throwProviderUsagePending(reservation, {
  idempotencyKey,
  providerRequestId = null,
  cancellation = null,
} = {}) {
  const pending = await retainAccountingPending(reservation);
  throw new BudgetProviderUsagePendingError({
    reservation: reservationMetadata(pending.reservation || reservation),
    idempotencyKey,
    providerRequestId,
    cancellation,
    accountingError: pending.accountingError,
  });
}

export async function commitProviderUsage(reservation, commitInput, context = {}) {
  let hasUsage = false;
  try {
    hasUsage = hasPositiveMeteredUsage(commitInput.usage);
  } catch {
    hasUsage = false;
  }
  if (!hasUsage) {
    return throwProviderUsagePending(reservation, {
      idempotencyKey: commitInput.idempotencyKey,
      providerRequestId: commitInput.providerRequestId || null,
      cancellation: context.cancellation || null,
    });
  }
  try {
    return await retryTransientBudgetCommit(
      () => commitSpend(reservation.id, commitInput),
    );
  } catch (error) {
    const exhausted = error instanceof BudgetCommitRetryExhaustedError;
    const pending = await retainAccountingPending(reservation);
    throw new BudgetCommitPendingError({
      reservation: reservationMetadata(pending.reservation || reservation),
      idempotencyKey: commitInput.idempotencyKey,
      attempts: exhausted ? error.attempts : 1,
      cause: exhausted ? error.cause : error,
      originalError: context.originalError || null,
      cancellation: context.cancellation || null,
      retryable: exhausted,
      accountingError: pending.accountingError,
    });
  }
}

export async function beginReservedProviderCall(reservation) {
  try {
    return await markProviderStarted(reservation.id);
  } catch (error) {
    await releaseKnownSafe(
      () => releaseSpend(reservation.id, { allowProviderStarted: true }),
      { reservation, originalError: error },
    );
    throw error;
  }
}

async function markOngoingProviderInterval(reservation, idempotencyKey) {
  try {
    return await markProviderStarted(reservation.id);
  } catch (error) {
    const pending = await retainAccountingPending(reservation);
    throw new BudgetProviderOutcomePendingError({
      reservation: reservationMetadata(pending.reservation || reservation),
      idempotencyKey,
      cause: error,
      accountingError: pending.accountingError,
    });
  }
}

export async function handleReservedProviderFailure(reservation, error, {
  cancellation = null,
  idempotencyKey = null,
} = {}) {
  const cancellationContext = cancellation
    || (error?.code === 'PAID_JOB_CANCELLED' || error?.name === 'AbortError' ? error : null);
  if (isExplicitNonBillableProviderError(error)) {
    await releaseKnownSafe(
      () => releaseSpend(reservation.id, { allowProviderStarted: true }),
      { reservation, idempotencyKey, originalError: error },
    );
    throw cancellationContext || error;
  }
  const pending = await retainAccountingPending(reservation);
  throw new BudgetProviderOutcomePendingError({
    reservation: reservationMetadata(pending.reservation || reservation),
    idempotencyKey,
    cause: error,
    cancellation: cancellationContext,
    accountingError: pending.accountingError,
  });
}

export function requestBudgetScope(req, operation, identity = '') {
  if (!req._budgetExecutionScope) {
    const supplied = req.headers?.['x-idempotency-key'] || req.headers?.['x-request-id'];
    req._budgetExecutionScope = supplied || crypto.randomUUID();
  }
  return budgetIdempotencyKey('request', operation, req._budgetExecutionScope, identity);
}

export async function reserveProviderSpend({
  idempotencyKey,
  organizationId,
  userId,
  transcriptionId = null,
  operation,
  model,
  provider = inferProviderForModel(model),
  estimatedUsage,
  reservationMs = DEFAULT_RESERVATION_MS,
  stopOnDenied = false,
}) {
  let price;
  try {
    price = await resolveProviderPrice({ provider, model, operation, organizationId });
  } catch (error) {
    if (error?.code === 'PRICING_CONFIGURATION_MISSING') throw error;
    throw new BudgetAccountingUnavailableError(error);
  }
  const estimate = calculateUsageCost(price, estimatedUsage);
  const amountMicros = Math.max(1, Math.ceil(estimate.estimatedCostMicros * 1.25));
  return reserveSpend({
    idempotencyKey,
    organizationId,
    userId,
    transcriptionId,
    operation,
    amountMicros,
    expiresAt: new Date(Date.now() + reservationMs),
    stopOnDenied,
    speculative: operation === 'meeting_transcription',
  });
}

async function durableBudgetStopReason(options, executionStartedAt, reservationPeriodStart) {
  if (options.transcriptionId) {
    const result = await query(
      `SELECT status, cancel_requested_at, cancel_reason, budget_stop_state
         FROM transcriptions
        WHERE id = $1 AND organization_id = $2`,
      [options.transcriptionId, options.organizationId],
    );
    const row = result.rows[0];
    if (!row || row.cancel_requested_at || row.budget_stop_state !== 'none'
        || ['cancelled', 'error'].includes(row.status)) {
      return new PaidJobCancelledError(row?.cancel_reason || 'Paid job is no longer active.');
    }
    return null;
  }

  const result = await query(
    `SELECT reason
     FROM budget_stop_outbox
       WHERE organization_id = $1
         AND period_start = $3::date
         AND updated_at >= $4
         AND COALESCE(payload->>'scope', '') <> 'transcription'
         AND COALESCE(payload->>'scopeAbortSuperseded', 'false') <> 'true'
         AND (user_id IS NULL OR user_id = $2)
      ORDER BY updated_at ASC, id ASC
      LIMIT 1`,
    [options.organizationId, options.userId, reservationPeriodStart, executionStartedAt.toISOString()],
  );
  return result.rows[0]
    ? new PaidJobCancelledError(result.rows[0].reason || 'budget_stop')
    : null;
}

function abortReason(signal) {
  if (!signal.aborted) return null;
  if (signal.reason instanceof Error) return signal.reason;
  return new PaidJobCancelledError(signal.reason || 'Paid job was cancelled.');
}

export async function executeReservedSpend(options, execute, usageFromResult = (result) => result?.usage || {}) {
  const reservation = await reserveProviderSpend(options);
  if (reservation.idempotent_replay) {
    if (reservation.state === 'reserved') {
      throw new BudgetCommitPendingError({
        reservation: reservationMetadata(reservation),
        idempotencyKey: budgetIdempotencyKey('usage', options.idempotencyKey),
      });
    }
    const error = new Error('Paid operation idempotency key was already used.');
    error.code = 'PAID_OPERATION_REPLAY';
    error.reservationState = reservation.state;
    throw error;
  }
  const executionStartedAt = new Date(reservation.created_at || Date.now());
  const controller = new AbortController();
  const execution = registerBudgetExecution({
    organizationId: options.organizationId,
    userId: options.userId,
    periodStart: reservation.period_start,
    controller,
  });
  const checkStop = () => durableBudgetStopReason(options, executionStartedAt, reservation.period_start);
  let stopPolling = () => {};
  let result;
  let providerStarted = false;
  let providerError = null;
  try {
    let initialStop;
    try {
      initialStop = await checkStop();
    } catch (error) {
      initialStop = new BudgetAccountingUnavailableError(error);
    }
    if (initialStop && !controller.signal.aborted) controller.abort(initialStop);
    if (controller.signal.aborted) throw abortReason(controller.signal);
    stopPolling = startAbortPolling({
      controller,
      check: checkStop,
      intervalMs: BUDGET_STOP_POLL_INTERVAL_MS,
      immediate: false,
      failureReason: (error) => new BudgetAccountingUnavailableError(error),
    });
    await beginReservedProviderCall(reservation);
    providerStarted = true;
    result = await execute(reservation, execution.signal);
    let finalStop;
    try {
      finalStop = await checkStop();
    } catch (error) {
      finalStop = new BudgetAccountingUnavailableError(error);
    }
    if (finalStop && !controller.signal.aborted) controller.abort(finalStop);
  } catch (error) {
    providerError = error;
  } finally {
    stopPolling();
    execution.unregister();
  }

  const cancellation = abortReason(controller.signal);
  if (providerError) {
    let providerErrorHasUsage = false;
    try {
      providerErrorHasUsage = providerError.providerUsage
        && hasPositiveMeteredUsage(providerError.providerUsage);
    } catch {
      providerErrorHasUsage = false;
    }
    if (providerErrorHasUsage) {
      await commitProviderUsage(reservation, {
        provider: options.provider || inferProviderForModel(providerError.providerModel || options.model),
        model: providerError.providerModel || options.model,
        usage: providerError.providerUsage,
        providerRequestId: providerError.providerRequestId || null,
        idempotencyKey: budgetIdempotencyKey('usage', options.idempotencyKey),
      }, {
        originalError: providerError,
        cancellation,
      });
      throw cancellation || providerError;
    }
    if (!providerStarted) {
      await releaseKnownSafe(() => releaseSpend(reservation.id), {
        reservation,
        idempotencyKey: budgetIdempotencyKey('usage', options.idempotencyKey),
        originalError: providerError,
      });
      throw cancellation || providerError;
    }
    return handleReservedProviderFailure(reservation, providerError, {
      cancellation,
      idempotencyKey: budgetIdempotencyKey('usage', options.idempotencyKey),
    });
  }

  if (!providerStarted) {
    await releaseKnownSafe(() => releaseSpend(reservation.id), {
      reservation,
      idempotencyKey: budgetIdempotencyKey('usage', options.idempotencyKey),
      originalError: cancellation,
    });
    throw cancellation || new PaidJobCancelledError();
  }

  const actualModel = result?.model || options.model;
  const actualUsage = usageFromResult(result);
  await commitProviderUsage(reservation, {
    provider: options.provider || inferProviderForModel(actualModel),
    model: actualModel,
    usage: actualUsage,
    providerRequestId: result?.providerRequestId || null,
    idempotencyKey: budgetIdempotencyKey('usage', options.idempotencyKey),
  }, {
    cancellation,
  });
  if (cancellation) throw cancellation;
  return result;
}

export async function assertTranscriptionPaidWorkActive(transcriptionId) {
  const result = await query(
    `SELECT status, cancel_requested_at, cancel_reason, budget_stop_state
       FROM transcriptions WHERE id = $1`,
    [transcriptionId],
  );
  const row = result.rows[0];
  if (!row || row.cancel_requested_at || row.budget_stop_state !== 'none'
      || ['cancelled', 'error'].includes(row.status)) {
    throw new PaidJobCancelledError(row?.cancel_reason || 'Paid job is no longer active.');
  }
  return row;
}

export function paidJobAbortSignal(transcriptionId, scope = {}) {
  const id = Number(transcriptionId);
  let entry = activeJobControllers.get(id);
  if (!entry || entry.controller.signal.aborted) {
    entry = { controller: new AbortController(), organizationId: null, userId: null };
    activeJobControllers.set(id, entry);
  }
  if (scope.organizationId !== undefined) entry.organizationId = scope.organizationId;
  if (scope.userId !== undefined) entry.userId = scope.userId;
  return entry.controller.signal;
}

export function abortPaidJobs(transcriptionIds, reason = 'budget_stop') {
  for (const rawId of transcriptionIds || []) {
    const id = Number(rawId);
    const entry = activeJobControllers.get(id);
    if (entry && !entry.controller.signal.aborted) entry.controller.abort(new PaidJobCancelledError(reason));
    activeJobControllers.delete(id);
  }
}

export function abortPaidJobsForScope(organizationId, userId = null, periodStart, reason = 'budget_stop') {
  return abortBudgetExecutionsForScope(organizationId, userId, periodStart, reason);
}

export async function checkpointMeetingStt({
  transcriptionId,
  organizationId,
  userId,
  observedSeconds,
  final = false,
}) {
  const observed = Math.max(0, Math.ceil(Number(observedSeconds) || 0));
  await assertTranscriptionPaidWorkActive(transcriptionId);
  const accountedResult = await query(
    `SELECT COALESCE(SUM(input_quantity), 0)::bigint AS seconds
       FROM usage_log
      WHERE transcription_id = $1 AND organization_id = $2
        AND operation = 'meeting_transcription'`,
    [transcriptionId, organizationId],
  );
  const accounted = Number(accountedResult.rows[0]?.seconds || 0);
  const plan = planMeetingCheckpoint({ observedSeconds: observed, accountedSeconds: accounted, final });
  let committed = null;
  for (const range of plan.ranges) {
    const key = budgetIdempotencyKey(
      'meeting-stt', transcriptionId, range.start, range.reservationEnd,
    );
    // eslint-disable-next-line no-await-in-loop
    const reservation = await reserveProviderSpend({
      idempotencyKey: key,
      organizationId,
      userId,
      transcriptionId,
      operation: 'meeting_transcription',
      provider: 'cortecs',
      model: 'whisper-large-v3',
      estimatedUsage: { inputQuantity: 30, outputQuantity: 0 },
      reservationMs: 6 * 60 * 60 * 1000,
      stopOnDenied: true,
    });
    // eslint-disable-next-line no-await-in-loop
    if (reservation.state === 'reserved') {
      // eslint-disable-next-line no-await-in-loop
      await markOngoingProviderInterval(reservation, key);
    }
    // eslint-disable-next-line no-await-in-loop
    committed = await commitProviderUsage(reservation, {
      provider: 'cortecs',
      model: 'whisper-large-v3',
      usage: { inputQuantity: range.usageEnd - range.start, outputQuantity: 0 },
      idempotencyKey: budgetIdempotencyKey('usage', key),
    });
  }
  if (!final) {
    if (!observed) return committed;
    const nextKey = budgetIdempotencyKey(
      'meeting-stt', transcriptionId, plan.speculativeStart, plan.speculativeStart + 30,
    );
    const nextReservation = await reserveProviderSpend({
      idempotencyKey: nextKey,
      organizationId,
      userId,
      transcriptionId,
      operation: 'meeting_transcription',
      provider: 'cortecs',
      model: 'whisper-large-v3',
      estimatedUsage: { inputQuantity: 30, outputQuantity: 0 },
      reservationMs: 6 * 60 * 60 * 1000,
      stopOnDenied: true,
    });
    if (nextReservation.state === 'reserved') {
      await markOngoingProviderInterval(nextReservation, nextKey);
    }
  } else {
    const unusedKey = budgetIdempotencyKey(
      'meeting-stt', transcriptionId, plan.speculativeStart, plan.speculativeStart + 30,
    );
    await releaseKnownSafe(
      () => releaseSpendByIdempotencyKey({
        organizationId,
        userId,
        transcriptionId,
        idempotencyKey: unusedKey,
        speculativeOnly: true,
        allowProviderStarted: true,
      }),
      {
        reservation: { organizationId, userId, transcriptionId },
        idempotencyKey: unusedKey,
      },
    );
  }
  return committed;
}
