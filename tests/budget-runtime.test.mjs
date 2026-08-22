import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BudgetCommitPendingError,
  BudgetCommitRetryExhaustedError,
  BudgetProviderOutcomePendingError,
  BudgetProviderUsagePendingError,
  BudgetReleasePendingError,
  budgetIdempotencyKey,
  isCurrentBudgetPeriod,
  isExplicitNonBillableProviderError,
  planMeetingCheckpoint,
  decideReservationDenial,
  estimateTextUsage,
  hasPositiveMeteredUsage,
  retryTransientBudgetCommit,
  stopRetryDelayMs,
} from '../lib/budget-runtime-core.js';
import {
  abortBudgetExecutionsForScope,
  composeAbortSignals,
  PaidJobCancelledError,
  registerBudgetExecution,
  startAbortPolling,
} from '../lib/budget-cancellation.js';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('budget keys are deterministic, bounded, and object-order independent', () => {
  const first = budgetIdempotencyKey('live translation', 42, { b: 2, a: 1 });
  const second = budgetIdempotencyKey('live translation', 42, { a: 1, b: 2 });
  assert.equal(first, second);
  assert.notEqual(first, budgetIdempotencyKey('live translation', 43, { a: 1, b: 2 }));
  assert.ok(first.length <= 180);
  assert.match(first, /^live-translation:[a-f0-9]{64}$/);
});

test('text estimates include conservative prompt and output buffers', () => {
  const usage = estimateTextUsage('x'.repeat(300), {
    inputBufferTokens: 50,
    outputMultiplier: 1.5,
    outputBufferTokens: 75,
  });
  assert.deepEqual(usage, { inputQuantity: 150, outputQuantity: 225 });
});

test('an oversized request is denied without a stop while an exhausted scope requests one', () => {
  assert.deepEqual(decideReservationDenial({
    amountMicros: 120,
    workspaceRemainingMicros: 100,
    memberRemainingMicros: 200,
    stopOnDenied: true,
  }), {
    scope: 'workspace', availableMicros: 100, requestStop: false,
  });
  assert.deepEqual(decideReservationDenial({
    amountMicros: 120,
    workspaceRemainingMicros: 100,
    memberRemainingMicros: 0,
    stopOnDenied: true,
  }), {
    scope: 'member', availableMicros: 0, requestStop: true,
  });
  assert.deepEqual(decideReservationDenial({
    amountMicros: 1,
    workspaceRemainingMicros: 0,
    memberRemainingMicros: 0,
    stopOnDenied: true,
  }), {
    scope: 'workspace', availableMicros: 0, requestStop: true,
  });
});

test('transient usage commits retry idempotently and preserve non-transient errors', async () => {
  let calls = 0;
  const delays = [];
  const committed = await retryTransientBudgetCommit(async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error('db unavailable'), { code: 'BUDGET_ACCOUNTING_UNAVAILABLE' });
    return { id: 42 };
  }, {
    maxAttempts: 3,
    baseDelayMs: 5,
    sleep: async (delay) => delays.push(delay),
  });
  assert.deepEqual(committed, { id: 42 });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [5, 10]);

  const configurationError = Object.assign(new Error('bad usage'), { code: 'INVALID_USAGE_QUANTITY' });
  calls = 0;
  await assert.rejects(
    retryTransientBudgetCommit(async () => {
      calls += 1;
      throw configurationError;
    }),
    (error) => error === configurationError,
  );
  assert.equal(calls, 1);
});

test('exhausted commit retries and pending errors retain accountable hold metadata', async () => {
  let calls = 0;
  await assert.rejects(
    retryTransientBudgetCommit(async () => {
      calls += 1;
      throw Object.assign(new Error('db unavailable'), { code: 'BUDGET_ACCOUNTING_UNAVAILABLE' });
    }, { maxAttempts: 2, baseDelayMs: 0 }),
    (error) => error instanceof BudgetCommitRetryExhaustedError && error.attempts === 2,
  );
  assert.equal(calls, 2);

  const pending = new BudgetCommitPendingError({
    reservationId: 9,
    idempotencyKey: 'usage:key',
    attempts: 3,
  });
  assert.equal(pending.code, 'BUDGET_ACCOUNTING_UNAVAILABLE');
  assert.equal(pending.accountingCode, 'BUDGET_COMMIT_PENDING');
  assert.equal(pending.accountingState, 'reservation_held');
  assert.equal(pending.reservationId, 9);
  assert.equal(pending.attempts, 3);
  assert.equal(pending.retryable, true);

  const invalidUsage = new BudgetCommitPendingError({
    reservation: { id: 11 },
    cause: Object.assign(new TypeError('bad usage'), { code: 'INVALID_USAGE_QUANTITY' }),
    retryable: false,
  });
  assert.equal(invalidUsage.retryable, false);
  assert.equal(invalidUsage.permanent, true);
  assert.equal(invalidUsage.commitFailureCode, 'INVALID_USAGE_QUANTITY');

  const cancellation = Object.assign(new Error('budget stopped'), { code: 'PAID_JOB_CANCELLED' });
  const uncertain = new BudgetProviderOutcomePendingError({
    reservation: { id: 10, transcriptionId: 22, operation: 'analysis' },
    idempotencyKey: 'usage:uncertain',
    cause: cancellation,
    cancellation,
  });
  assert.equal(uncertain.accountingCode, 'BUDGET_PROVIDER_OUTCOME_PENDING');
  assert.equal(uncertain.reservationId, 10);
  assert.equal(uncertain.reservation.transcriptionId, 22);
  assert.equal(uncertain.cancellation, cancellation);
});

test('only explicit non-billable provider rejections are releasable after provider start', () => {
  assert.equal(isExplicitNonBillableProviderError({ status: 400 }), true);
  assert.equal(isExplicitNonBillableProviderError({ response: { status: 429 } }), true);
  assert.equal(isExplicitNonBillableProviderError({ status: 408 }), false);
  assert.equal(isExplicitNonBillableProviderError({ status: 503 }), false);
  assert.equal(isExplicitNonBillableProviderError(Object.assign(new Error('network'), { code: 'ECONNRESET' })), false);
  assert.equal(isExplicitNonBillableProviderError({ providerOutcome: 'non_billable' }), true);
});

test('successful accounting requires positive input or output usage', () => {
  assert.equal(hasPositiveMeteredUsage({}), false);
  assert.equal(hasPositiveMeteredUsage({ input_tokens: 0, output_tokens: 0 }), false);
  assert.equal(hasPositiveMeteredUsage({ input_tokens: 4, output_tokens: 0 }), true);
  assert.equal(hasPositiveMeteredUsage({ input_tokens: 0, output_tokens: 2 }), true);
  assert.equal(hasPositiveMeteredUsage({ cache_read_input_tokens: 3 }), true);

  const usagePending = new BudgetProviderUsagePendingError({ reservation: { id: 12 } });
  assert.equal(usagePending.accountingCode, 'BUDGET_PROVIDER_USAGE_PENDING');
  assert.equal(usagePending.accountingState, 'reservation_held');
  const releasePending = new BudgetReleasePendingError({ reservation: { id: 13 }, attempts: 3 });
  assert.equal(releasePending.accountingCode, 'BUDGET_RELEASE_PENDING');
  assert.equal(releasePending.attempts, 3);
});

test('meeting checkpoint plans retain and clean the correct speculative interval', () => {
  assert.deepEqual(planMeetingCheckpoint({ observedSeconds: 60, accountedSeconds: 60, final: true }), {
    observed: 60,
    accounted: 60,
    checkpoint: 60,
    ranges: [],
    speculativeStart: 60,
  });
  assert.deepEqual(planMeetingCheckpoint({ observedSeconds: 42, accountedSeconds: 30, final: true }).ranges, [
    { start: 30, reservationEnd: 60, usageEnd: 42 },
  ]);
  assert.equal(
    planMeetingCheckpoint({ observedSeconds: 0, accountedSeconds: 0, final: true }).speculativeStart,
    0,
  );
});

test('budget periods compare in UTC and reject old-period scope stops', () => {
  const now = new Date('2026-07-27T12:00:00Z');
  assert.equal(isCurrentBudgetPeriod('2026-07-01', now), true);
  assert.equal(isCurrentBudgetPeriod(new Date('2026-07-01T00:00:00Z'), now), true);
  assert.equal(isCurrentBudgetPeriod('2026-06-01', now), false);
});

test('all paid runtime families use reservation commits instead of direct usage logging', () => {
  const files = [
    '../pages/api/translate.js',
    '../pages/api/translate/file.js',
    '../pages/api/ocr.js',
    '../pages/api/text-optimization.js',
    '../pages/api/templates/generate.js',
    '../pages/api/knowledge-prep/text.js',
    '../lib/manual-analysis.js',
    '../lib/transcription-worker.js',
    '../lib/vexa-bridge.js',
    '../lib/in-meeting-audio.js',
    '../pages/api/transcriptions/[id]/audio.js',
    '../pages/api/share/[token]/audio.js',
  ];
  for (const path of files) {
    const body = source(path);
    assert.match(body, /reserveProviderSpend|executeReservedSpend|commitSpend|checkpointMeetingStt/, path);
    assert.doesNotMatch(body, /logUsage\s*\(/, path);
  }
});

test('synchronous paid executions register by workspace and member and unregister deterministically', () => {
  const first = registerBudgetExecution({ organizationId: 7, userId: 41, periodStart: '2026-07-01' });
  const second = registerBudgetExecution({ organizationId: 7, userId: 42, periodStart: '2026-07-01' });
  const priorPeriod = registerBudgetExecution({ organizationId: 7, userId: 41, periodStart: '2026-06-01' });
  const otherWorkspace = registerBudgetExecution({ organizationId: 8, userId: 41, periodStart: '2026-07-01' });

  assert.equal(abortBudgetExecutionsForScope(7, 41, '2026-07-01', 'member budget stop'), 1);
  assert.equal(first.signal.aborted, true);
  assert.equal(first.signal.reason.code, 'PAID_JOB_CANCELLED');
  assert.equal(second.signal.aborted, false);
  assert.equal(priorPeriod.signal.aborted, false);
  assert.equal(otherWorkspace.signal.aborted, false);

  second.unregister();
  assert.equal(abortBudgetExecutionsForScope(7, null, '2026-07-01', 'workspace budget stop'), 0);
  assert.equal(abortBudgetExecutionsForScope(7, null, '2026-06-01', 'prior stop'), 1);
  assert.equal(abortBudgetExecutionsForScope(8, null, '2026-07-01', 'workspace budget stop'), 1);
  assert.equal(priorPeriod.signal.reason.message, 'prior stop');
  assert.equal(otherWorkspace.signal.reason.message, 'workspace budget stop');
});

test('durable polling aborts with the stop reason and fails closed on database errors', async () => {
  const stoppedController = new AbortController();
  const stopReason = new PaidJobCancelledError('durable stop');
  const stopPolling = startAbortPolling({
    controller: stoppedController,
    check: async () => stopReason,
    intervalMs: 1,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stoppedController.signal.aborted, true);
  assert.equal(stoppedController.signal.reason, stopReason);
  stopPolling();

  const failedController = new AbortController();
  const accountingError = Object.assign(new Error('accounting unavailable'), {
    code: 'BUDGET_ACCOUNTING_UNAVAILABLE',
  });
  const stopFailedPolling = startAbortPolling({
    controller: failedController,
    check: async () => { throw new Error('db offline'); },
    intervalMs: 1,
    failureReason: () => accountingError,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failedController.signal.aborted, true);
  assert.equal(failedController.signal.reason, accountingError);
  stopFailedPolling();
});

test('budget polling cleanup clears its pending timer and prevents later checks', () => {
  const controller = new AbortController();
  const token = { id: 1 };
  let scheduled = null;
  let cleared = null;
  let checks = 0;
  const stop = startAbortPolling({
    controller,
    check: async () => { checks += 1; return null; },
    intervalMs: 500,
    immediate: false,
    setTimer: (callback, delay) => {
      scheduled = { callback, delay };
      return token;
    },
    clearTimer: (value) => { cleared = value; },
  });
  assert.equal(scheduled.delay, 500);
  stop();
  assert.equal(cleared, token);
  scheduled.callback();
  assert.equal(checks, 0);
});

test('composed signals preserve cancellation reasons from every source', () => {
  const disconnect = new AbortController();
  const budget = new AbortController();
  const composed = composeAbortSignals(disconnect.signal, budget.signal);
  const reason = new PaidJobCancelledError('budget stopped');
  budget.abort(reason);
  assert.equal(composed.aborted, true);
  assert.equal(composed.reason, reason);

  const alreadyAborted = new AbortController();
  alreadyAborted.abort(Object.assign(new Error('client disconnected'), { code: 'CLIENT_DISCONNECTED' }));
  assert.equal(composeAbortSignals(alreadyAborted.signal, new AbortController().signal).reason.code, 'CLIENT_DISCONNECTED');
});

test('durable stop worker is scheduled and reconcile updates cannot revive stopped meetings', () => {
  assert.match(source('../instrumentation.js'), /ensureBudgetStopWorkerRunning/);
  const worker = source('../lib/budget-stop-worker.js');
  assert.match(worker, /processNextBudgetStop/);
  assert.match(worker, /stopBridgeForTranscription/);
  assert.match(worker, /stopInMeetingAudio/);
  assert.match(worker, /stopBot/);
  assert.match(worker, /effectiveEvent\.payload\?\.transcriptionIds/);
  assert.match(worker, /scopeAbortSuperseded !== true/);
  assert.match(worker, /effectiveEvent\.period_start/);
  assert.doesNotMatch(worker, /isCurrentBudgetPeriod/);
  assert.match(source('../lib/budget-service.js'), /scope: 'transcription'/);
  const reconcile = source('../pages/api/admin/vexa/reconcile.js');
  assert.match(reconcile, /budget_stop_state = 'none'/);
});

test('dynamic OpenRouter pricing covers the dedicated knowledge-preparation operation', () => {
  assert.match(source('../lib/openrouter-pricing.js'), /'knowledge_prep'/);
});

test('OCR capture retries derive budget scope without request-specific entropy', () => {
  const ocr = source('../pages/api/ocr.js');
  assert.match(ocr, /clientCaptureId\s*\?\s*budgetIdempotencyKey\('ocr-capture', orgId, userId, clientCaptureId\)/);
  assert.match(ocr, /:\s*requestBudgetScope\(req, 'ocr', file\.originalFilename \|\| filename\)/);
  assert.doesNotMatch(ocr, /requestBudgetScope\(req, 'ocr', clientCaptureId/);

  const firstRetry = budgetIdempotencyKey('ocr-capture', 7, 42, 'capture-id');
  const concurrentRetry = budgetIdempotencyKey('ocr-capture', 7, 42, 'capture-id');
  assert.equal(firstRetry, concurrentRetry);
  assert.notEqual(firstRetry, budgetIdempotencyKey('ocr-capture', 7, 43, 'capture-id'));
});

test('queued and manual transcription entry points require paid execution authority', () => {
  assert.match(source('../pages/api/transcriptions/[id]/process.js'), /hasPermission\(req\.role, 'paid\.execute'\)/);
  assert.match(source('../pages/api/transcriptions/[id]/analyze.js'), /hasPermission\(req\.role, 'paid\.execute'\)/);
  assert.match(source('../pages/api/meetings/index.js'), /hasPermission\(req\.role, 'paid\.execute'\)/);
});

test('provider HTTP helpers compose cancellation with timeout and chunk work checks cancellation', () => {
  assert.match(source('../lib/network-guard.js'), /AbortSignal\.any/);
  const ai = source('../lib/ai-service.js');
  assert.match(ai, /beforeChunk/);
  assert.match(ai, /afterChunk/);
  assert.match(ai, /signal\?\.aborted/);
  assert.match(source('../lib/budget-stop-worker.js'), /abortPaidJobsForScope/);
});

test('every reserved provider execution receives and composes the durable budget signal', () => {
  const runtime = source('../lib/budget-runtime.js');
  assert.match(runtime, /registerBudgetExecution/);
  assert.match(runtime, /budget_stop_outbox/);
  assert.match(runtime, /period_start = \$3::date/);
  assert.match(runtime, /updated_at >= \$4/);
  assert.match(runtime, /scopeAbortSuperseded/);
  assert.match(runtime, /periodStart: reservation\.period_start/);
  assert.match(runtime, /execute\(reservation, execution\.signal\)/);
  assert.match(runtime, /BudgetAccountingUnavailableError/);

  const files = [
    '../pages/api/translate.js',
    '../pages/api/translate/file.js',
    '../pages/api/ocr.js',
    '../pages/api/text-optimization.js',
    '../pages/api/templates/generate.js',
    '../pages/api/knowledge-prep/text.js',
    '../lib/manual-analysis.js',
    '../lib/transcription-worker.js',
    '../lib/vexa-bridge.js',
    '../lib/in-meeting-audio.js',
    '../pages/api/transcriptions/[id]/audio.js',
    '../pages/api/share/[token]/audio.js',
  ];
  for (const path of files) {
    const body = source(path);
    assert.match(body, /budgetSignal/, path);
    assert.match(body, /composeAbortSignals/, path);
  }
});

test('reserved holds ignore expiry and stale reconciliation remains terminal-job scoped', () => {
  const service = source('../lib/budget-service.js');
  assert.match(service, /AND state = 'reserved'\$\{where\}/);
  assert.doesNotMatch(service, /state = 'reserved' AND expires_at > NOW\(\)/);
  assert.match(service, /state = 'reserved' AND expires_at < NOW\(\)/);
  assert.match(service, /reservation\.transcription_id === null/);
  assert.match(service, /lifecycle_tracked_at IS NOT NULL/);
  assert.match(service, /provider_started_at IS NULL/);
  assert.match(service, /accounting_pending_at IS NULL/);
  assert.match(service, /await isTerminal\(reservation\)\) === true/);
  const worker = source('../lib/budget-stop-worker.js');
  assert.match(worker, /Boolean\(row\)/);
  assert.match(worker, /'transcribed'/);
  assert.doesNotMatch(worker, /return !row/);
});

test('provider lifecycle stamps precede calls and uncertain outcomes retain holds', () => {
  const runtime = source('../lib/budget-runtime.js');
  assert.ok(runtime.indexOf('await beginReservedProviderCall(reservation)')
    < runtime.indexOf('result = await execute(reservation, execution.signal)'));
  assert.match(runtime, /markAccountingPending\(reservation\.id\)/);
  assert.match(runtime, /BudgetProviderOutcomePendingError/);
  assert.match(runtime, /allowProviderStarted: true/);
  assert.match(runtime, /COALESCE\(payload->>'scope', ''\) <> 'transcription'/);
  assert.doesNotMatch(runtime, /period_start = DATE_TRUNC\('month', CURRENT_TIMESTAMP/);
  assert.match(runtime, /finalStop = await checkStop\(\)/);
  assert.ok(runtime.indexOf('finalStop = await checkStop()')
    < runtime.indexOf('execution.unregister()'));
  assert.match(runtime, /BudgetProviderUsagePendingError/);
  assert.match(runtime, /hasPositiveMeteredUsage/);

  const ai = source('../lib/ai-service.js');
  assert.match(ai, /chunkContext\?\.onProviderError/);
  assert.match(ai, /error\?\.providerOutcome === 'non_billable'/);
  assert.doesNotMatch(ai, /if \(chunkContext\?\.release\) await chunkContext\.release\(\)/);
});

test('upload and meeting usage use the common retried commit helper', () => {
  const uploadWorker = source('../lib/transcription-worker.js');
  assert.match(uploadWorker, /executeChunk: async/);
  assert.match(uploadWorker, /executeReservedSpend\(\{/);
  assert.match(uploadWorker, /composeAbortSignals\(signal, budgetSignal\)/);
  assert.doesNotMatch(uploadWorker, /beforeChunk:/);
  assert.doesNotMatch(uploadWorker, /commitSpend/);

  const ai = source('../lib/ai-service.js');
  assert.match(ai, /executeChunk/);
  assert.match(ai, /execute: executeRequest/);

  const runtime = source('../lib/budget-runtime.js');
  const checkpoint = runtime.slice(runtime.indexOf('export async function checkpointMeetingStt'));
  assert.match(checkpoint, /commitProviderUsage\(reservation/);
  assert.match(checkpoint, /releaseSpendByIdempotencyKey/);
  assert.match(checkpoint, /markOngoingProviderInterval\(nextReservation, nextKey\)/);
  assert.match(checkpoint, /allowProviderStarted: true/);
  assert.doesNotMatch(checkpoint, /commitSpend\(/);
});

test('budget stop outbox payloads and finalization are exact and claim-version safe', () => {
  const service = source('../lib/budget-service.js');
  assert.match(service, /RETURNING id/);
  assert.match(service, /transcriptionIds/);
  assert.match(service, /revision = budget_stop_outbox\.revision \+ 1/);
  assert.match(service, /id = ANY\(\$2::integer\[\]\)/);
  assert.match(service, /state = 'processing' AND attempts = \$2 AND revision = \$3/);
  assert.match(service, /SET state = 'pending', available_at = NOW\(\), processed_at = NULL/);
  assert.doesNotMatch(service, /\(\$3::integer IS NULL OR id = \$3\)/);
});

test('a failing budget stop backs off exponentially up to a hard cap', () => {
  // attempts is the post-increment value, so the first failure is attempt 1 and
  // must keep the original 30s delay.
  assert.equal(stopRetryDelayMs(1), 30_000);
  assert.equal(stopRetryDelayMs(2), 60_000);
  assert.equal(stopRetryDelayMs(3), 120_000);
  assert.equal(stopRetryDelayMs(4), 240_000);
  assert.equal(stopRetryDelayMs(5), 480_000);
  // Sixth attempt would be 16 minutes; the cap holds it at 15 and never grows.
  assert.equal(stopRetryDelayMs(6), 900_000);
  assert.equal(stopRetryDelayMs(50), 900_000);
  // A runaway attempts value must stay finite rather than overflowing past the cap.
  assert.equal(stopRetryDelayMs(5000), 900_000);
  assert.ok(Number.isFinite(stopRetryDelayMs(Number.MAX_SAFE_INTEGER)));
  // Defensive inputs collapse to the base delay instead of NaN.
  assert.equal(stopRetryDelayMs(0), 30_000);
  assert.equal(stopRetryDelayMs(undefined), 30_000);
  assert.equal(stopRetryDelayMs('nonsense'), 30_000);
  assert.equal(stopRetryDelayMs(3, { baseMs: 1_000, maxMs: 5_000 }), 4_000);
  assert.equal(stopRetryDelayMs(9, { baseMs: 1_000, maxMs: 5_000 }), 5_000);
});

test('a persistently failing budget stop escalates once and keeps retrying', () => {
  const service = source('../lib/budget-service.js');
  // Backoff replaces the fixed 30s requeue that logged twice a minute forever.
  assert.match(service, /available_at = NOW\(\) \+ \(\$4::bigint \* INTERVAL '1 millisecond'\)/);
  assert.doesNotMatch(service, /available_at = NOW\(\) \+ INTERVAL '30 seconds'/);
  // The pre-update value decides escalation, so it fires exactly once.
  assert.match(service, /prev\.escalated_at AS previous_escalated_at/);
  assert.match(service, /row\.previous_escalated_at === null/);
  assert.match(service, /escalated_at IS NULL AND o\.attempts >= \$5/);
  assert.match(service, /action: 'budget\.stop_failing'/);
  assert.match(service, /severity: 'error'/);
  // Escalation must not become a dead letter: no terminal state, and the error
  // is still rethrown so the caller's retry loop stays intact.
  assert.doesNotMatch(service, /state = 'failed'/);
  assert.match(service, /RETURNING o\.attempts, o\.reason[\s\S]*?\n\s*throw error;/);
});

test('the stop outbox has no terminal failure state', () => {
  const schema = source('../lib/db-init.js');
  // Adding 'failed' here would silently strand a still-running paid bot.
  assert.match(schema, /CHECK \(state IN \('pending','processing','processed'\)\)/);
  assert.match(schema, /budget_stop_outbox ADD COLUMN IF NOT EXISTS escalated_at/);
});

test('only genuine limit relief supersedes pending current-period scope aborts', () => {
  const budgets = source('../pages/api/organizations/budgets.js');
  assert.match(budgets, /previous !== null && \(next === null \|\| next > previous\)/);
  assert.match(budgets, /scopeAbortSuperseded/);
  assert.match(budgets, /o\.state IN \('pending', 'processing'\)/);
  assert.match(budgets, /o\.revision \+ 1/);
  assert.match(budgets, /o\.period_start = date_trunc\('month', NOW\(\)\)::date/);
  assert.match(budgets, /NOT EXISTS \(\s*SELECT 1 FROM organization_member_budgets/);
  assert.match(budgets, /if \(supersedeWorkspaceAbort\) \{/);
});
