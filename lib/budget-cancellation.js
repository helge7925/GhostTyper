const activeExecutionControllers = new Map();
let nextExecutionId = 1;

export class PaidJobCancelledError extends Error {
  constructor(reason = 'Paid job was cancelled.') {
    super(reason);
    this.name = 'PaidJobCancelledError';
    this.code = 'PAID_JOB_CANCELLED';
  }
}

export function composeAbortSignals(...signals) {
  const active = signals.flat().filter(Boolean);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(active);

  const controller = new AbortController();
  for (const signal of active) {
    const abort = () => {
      if (!controller.signal.aborted) controller.abort(signal.reason);
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}

function normalizedPeriod(periodStart) {
  if (periodStart instanceof Date) return periodStart.toISOString().slice(0, 10);
  return String(periodStart || '').slice(0, 10);
}

export function registerBudgetExecution({
  organizationId,
  userId,
  periodStart,
  controller = new AbortController(),
}) {
  const id = nextExecutionId;
  nextExecutionId += 1;
  activeExecutionControllers.set(id, {
    organizationId,
    userId,
    periodStart: normalizedPeriod(periodStart),
    controller,
  });
  return {
    signal: controller.signal,
    unregister() {
      activeExecutionControllers.delete(id);
    },
  };
}

export function abortBudgetExecutionsForScope(
  organizationId,
  userId = null,
  periodStart,
  reason = 'budget_stop',
) {
  const eventPeriod = normalizedPeriod(periodStart);
  let aborted = 0;
  for (const [id, entry] of activeExecutionControllers) {
    if (String(entry.organizationId) !== String(organizationId)) continue;
    if (userId !== null && String(entry.userId) !== String(userId)) continue;
    if (!eventPeriod || entry.periodStart !== eventPeriod) continue;
    if (!entry.controller.signal.aborted) {
      entry.controller.abort(reason instanceof Error ? reason : new PaidJobCancelledError(reason));
      aborted += 1;
    }
    activeExecutionControllers.delete(id);
  }
  return aborted;
}

export function startAbortPolling({
  controller,
  check,
  intervalMs,
  immediate = true,
  failureReason = (error) => error,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let active = true;
  let timer = null;

  const schedule = () => {
    if (!active || controller.signal.aborted) return;
    timer = setTimer(run, intervalMs);
    if (timer?.unref) timer.unref();
  };

  const run = async () => {
    timer = null;
    if (!active || controller.signal.aborted) return;
    try {
      const reason = await check();
      if (active && reason && !controller.signal.aborted) controller.abort(reason);
    } catch (error) {
      if (active && !controller.signal.aborted) controller.abort(failureReason(error));
    } finally {
      schedule();
    }
  };

  if (immediate) void run();
  else schedule();

  return () => {
    active = false;
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
}
