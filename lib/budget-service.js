import pool from './db.js';
import { calculateBudgetAvailability, budgetLevel } from './budget-core.js';
import { calculateUsageCost, inferProviderForModel } from './pricing-core.js';
import { resolveProviderPrice } from './pricing-service.js';
import { logAuditEvent } from './audit-log.js';
import { logError } from './observability.js';
import { decideReservationDenial, stopRetryDelayMs } from './budget-runtime-core.js';

export class BudgetExceededError extends Error {
  constructor(scope, availableMicros) {
    super(`${scope} budget does not have enough available funds.`);
    this.name = 'BudgetExceededError';
    this.code = 'BUDGET_EXCEEDED';
    this.scope = scope;
    this.availableMicros = availableMicros;
  }
}

export class BudgetAccountingUnavailableError extends Error {
  constructor(cause) {
    super('Budget accounting is currently unavailable.');
    this.name = 'BudgetAccountingUnavailableError';
    this.code = 'BUDGET_ACCOUNTING_UNAVAILABLE';
    this.cause = cause;
  }
}

// A failing stop event is retried with exponential backoff instead of a fixed
// 30s interval, which kept a permanently broken event (Vexa integration removed,
// user token deleted) rewriting the row and logging an error twice a minute
// forever. The retry itself never stops: the local job abort already happened
// before the failing step, so what is still outstanding is a paid remote bot,
// and abandoning that would let it bill unattended. After
// STOP_ESCALATE_AFTER_ATTEMPTS the event escalates once — audit trail plus
// error log — and then keeps retrying quietly at the capped interval.
const STOP_RETRY_BASE_MS = Number(process.env.BUDGET_STOP_RETRY_BASE_MS) || 30_000;
const STOP_RETRY_MAX_MS = Number(process.env.BUDGET_STOP_RETRY_MAX_MS) || 900_000;
const STOP_ESCALATE_AFTER_ATTEMPTS = Number(process.env.BUDGET_STOP_ESCALATE_AFTER_ATTEMPTS) || 5;

function integer(value, field, { positive = false } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < (positive ? 1 : 0)) {
    throw Object.assign(new TypeError(`${field} is invalid.`), { code: 'INVALID_BUDGET_INPUT' });
  }
  return parsed;
}

function periodStart(value = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw Object.assign(new TypeError('Invalid budget period.'), { code: 'INVALID_BUDGET_INPUT' });
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function safeDbNumber(value) {
  const parsed = Number(value || 0);
  if (!Number.isSafeInteger(parsed)) throw new RangeError('Budget amount exceeds the safe integer range.');
  return parsed;
}

function centsToMicros(value) {
  const micros = safeDbNumber(value) * 10_000;
  if (!Number.isSafeInteger(micros)) throw new RangeError('Budget amount exceeds the safe integer range.');
  return micros;
}

async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function loadLimits(client, organizationId, userId) {
  const result = await client.query(
    `SELECT os.cost_limit_cents, os.member_monthly_budget_limit_cents,
            mb.monthly_limit_micros
       FROM organization_members m
       LEFT JOIN organization_settings os ON os.organization_id = m.organization_id
       LEFT JOIN organization_member_budgets mb
         ON mb.organization_id = m.organization_id AND mb.user_id = m.user_id
      WHERE m.organization_id = $1 AND m.user_id = $2`,
    [organizationId, userId],
  );
  if (!result.rowCount) throw Object.assign(new Error('User is not a member of the workspace.'), { code: 'ORG_MEMBERSHIP_REQUIRED' });
  const row = result.rows[0];
  return {
    workspaceLimitMicros: row.cost_limit_cents > 0 ? centsToMicros(row.cost_limit_cents) : null,
    memberLimitMicros: row.monthly_limit_micros > 0
      ? safeDbNumber(row.monthly_limit_micros)
      : row.member_monthly_budget_limit_cents > 0
        ? centsToMicros(row.member_monthly_budget_limit_cents)
        : null,
  };
}

async function usageCommitted(client, organizationId, start, userId = null) {
  const params = [organizationId, start];
  const userClause = userId === null ? '' : ` AND user_id = $${params.push(userId)}`;
  const result = await client.query(
    `SELECT COALESCE(SUM(COALESCE(estimated_cost_micros,
                ROUND(COALESCE(estimated_cost, 0) * 1000000)::bigint)), 0)::bigint AS amount
       FROM usage_log
      WHERE organization_id = $1
        AND created_at >= $2::date
        AND created_at < $2::date + INTERVAL '1 month'${userClause}`,
    params,
  );
  return safeDbNumber(result.rows[0]?.amount);
}

async function activeReserved(client, organizationId, start, userId = null, excludeReservationId = null) {
  const params = [organizationId, start];
  let where = '';
  if (userId !== null) where += ` AND user_id = $${params.push(userId)}`;
  if (excludeReservationId !== null) where += ` AND id <> $${params.push(excludeReservationId)}`;
  const result = await client.query(
    `SELECT COALESCE(SUM(amount_micros), 0)::bigint AS amount
       FROM budget_reservations
       WHERE organization_id = $1 AND period_start = $2::date
         AND state = 'reserved'${where}`,
    params,
  );
  return safeDbNumber(result.rows[0]?.amount);
}

async function lockPeriod(client, organizationId, start) {
  const existingCommitted = await usageCommitted(client, organizationId, start);
  await client.query(
    `INSERT INTO organization_budget_periods
       (organization_id, period_start, state, committed_micros, reserved_micros, version)
     VALUES ($1, $2::date, 'open', $3, 0, 0)
     ON CONFLICT (organization_id, period_start) DO NOTHING`,
    [organizationId, start, existingCommitted],
  );
  const result = await client.query(
    `SELECT * FROM organization_budget_periods
      WHERE organization_id = $1 AND period_start = $2::date FOR UPDATE`,
    [organizationId, start],
  );
  return result.rows[0];
}

async function currentAvailability(client, organizationId, userId, start, excludeReservationId = null) {
  const limits = await loadLimits(client, organizationId, userId);
  const [workspaceCommittedMicros, memberCommittedMicros, workspaceReservedMicros, memberReservedMicros] = await Promise.all([
    usageCommitted(client, organizationId, start),
    usageCommitted(client, organizationId, start, userId),
    activeReserved(client, organizationId, start, null, excludeReservationId),
    activeReserved(client, organizationId, start, userId, excludeReservationId),
  ]);
  return calculateBudgetAvailability({
    ...limits,
    workspaceCommittedMicros,
    memberCommittedMicros,
    workspaceReservedMicros,
    memberReservedMicros,
  });
}

export async function getSelfUsage(organizationId, userId, { at = new Date() } = {}) {
  const start = periodStart(at);
  const client = await pool.connect();
  try {
    const limits = await loadLimits(client, organizationId, userId);
    const [ownCostMicros, workspaceCostMicros, ownReservedMicros, workspaceReservedMicros] = await Promise.all([
      usageCommitted(client, organizationId, start, userId),
      usageCommitted(client, organizationId, start),
      activeReserved(client, organizationId, start, userId),
      activeReserved(client, organizationId, start),
    ]);
    const availability = calculateBudgetAvailability({
      ...limits,
      workspaceCommittedMicros: workspaceCostMicros,
      workspaceReservedMicros,
      memberCommittedMicros: ownCostMicros,
      memberReservedMicros: ownReservedMicros,
    });
    const levels = [
      budgetLevel({ costMicros: workspaceCostMicros + workspaceReservedMicros, limitMicros: limits.workspaceLimitMicros }),
      budgetLevel({ costMicros: ownCostMicros + ownReservedMicros, limitMicros: limits.memberLimitMicros }),
    ];
    const level = levels.includes('red') ? 'red' : levels.includes('yellow') ? 'yellow' : 'green';
    return {
      month: start.slice(0, 7),
      ownCostMicros,
      memberLimitMicros: limits.memberLimitMicros,
      effectiveRemainingMicros: availability.effectiveRemainingMicros,
      level,
    };
  } finally {
    client.release();
  }
}

export async function reserveSpend({
  idempotencyKey,
  organizationId,
  userId,
  transcriptionId = null,
  operation,
  amountMicros,
  expiresAt,
  stopOnDenied = false,
  speculative = false,
  at = new Date(),
}) {
  const key = String(idempotencyKey || '').trim();
  const normalizedOperation = String(operation || '').trim();
  const amount = integer(amountMicros, 'amountMicros', { positive: true });
  if (!key || key.length > 180 || !normalizedOperation || normalizedOperation.length > 80) {
    throw Object.assign(new TypeError('Reservation identity is invalid.'), { code: 'INVALID_BUDGET_INPUT' });
  }
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.valueOf()) || expiry <= new Date(at)) {
    throw Object.assign(new TypeError('expiresAt must be in the future.'), { code: 'INVALID_BUDGET_INPUT' });
  }
  const start = periodStart(at);
  try {
    const result = await withTransaction(async (client) => {
      const period = await lockPeriod(client, organizationId, start);
      const existing = await client.query(
        `SELECT * FROM budget_reservations WHERE organization_id = $1 AND idempotency_key = $2`,
        [organizationId, key],
      );
      if (existing.rowCount) {
        const row = existing.rows[0];
        if (Number(row.user_id) !== Number(userId) || safeDbNumber(row.amount_micros) !== amount || row.operation !== normalizedOperation) {
          throw Object.assign(new Error('Idempotency key was reused with different reservation data.'), { code: 'IDEMPOTENCY_CONFLICT' });
        }
        return { ...row, idempotent_replay: true };
      }
      if (period?.state === 'blocked') {
        throw new BudgetExceededError('workspace', 0);
      }
      if (transcriptionId !== null) {
        const transcription = await client.query(
          `SELECT 1 FROM transcriptions WHERE id = $1 AND organization_id = $2 AND user_id = $3`,
          [transcriptionId, organizationId, userId],
        );
        if (!transcription.rowCount) {
          throw Object.assign(new Error('Transcription is outside the reservation scope.'), { code: 'INVALID_BUDGET_INPUT' });
        }
      }
      const availability = await currentAvailability(client, organizationId, userId, start);
      const denial = decideReservationDenial({
        amountMicros: amount,
        workspaceRemainingMicros: availability.workspaceRemainingMicros,
        memberRemainingMicros: availability.memberRemainingMicros,
        stopOnDenied,
      });
      if (denial && !denial.requestStop) {
        throw new BudgetExceededError(denial.scope, denial.availableMicros);
      }
      if (denial?.scope === 'workspace') {
        await client.query(
          `UPDATE organization_budget_periods SET state = 'blocked', blocked_at = COALESCE(blocked_at, NOW()),
                  version = version + 1, updated_at = NOW()
            WHERE organization_id = $1 AND period_start = $2::date`,
          [organizationId, start],
        );
        await requestBudgetStop(client, {
          organizationId, userId, start, scope: 'workspace', reason: 'hard_budget_workspace',
        });
        return { budgetDenied: denial };
      }
      if (denial?.scope === 'member') {
        await requestBudgetStop(client, {
          organizationId, userId, start, scope: 'member', reason: 'hard_budget_member',
        });
        return { budgetDenied: denial };
      }
      const result = await client.query(
        `INSERT INTO budget_reservations
           (idempotency_key, organization_id, user_id, transcription_id, operation,
            amount_micros, state, period_start, expires_at, lifecycle_tracked_at, speculative)
         VALUES ($1,$2,$3,$4,$5,$6,'reserved',$7::date,$8,NOW(),$9) RETURNING *`,
        [key, organizationId, userId, transcriptionId, normalizedOperation, amount, start,
          expiry.toISOString(), Boolean(speculative)],
      );
      await client.query(
        `UPDATE organization_budget_periods
            SET reserved_micros = reserved_micros + $3, version = version + 1, updated_at = NOW()
          WHERE organization_id = $1 AND period_start = $2::date`,
        [organizationId, start, amount],
      );
      return { ...result.rows[0], idempotent_replay: false };
    });
    if (result?.budgetDenied) {
      throw new BudgetExceededError(result.budgetDenied.scope, result.budgetDenied.availableMicros);
    }
    return result;
  } catch (error) {
    if (error instanceof BudgetExceededError || error?.code === 'INVALID_BUDGET_INPUT' || error?.code === 'IDEMPOTENCY_CONFLICT') throw error;
    throw new BudgetAccountingUnavailableError(error);
  }
}

async function requestBudgetStop(client, {
  organizationId,
  userId,
  start,
  scope,
  reason,
  requestedBy = null,
  auditReason = null,
}) {
  const eventKey = `budget-stop:${organizationId}:${start}:${scope === 'member' ? `member:${userId}` : 'workspace'}`;
  const params = [organizationId, reason, userId];
  const userFilter = scope === 'member' ? ' AND user_id = $3' : '';
  const stopped = await client.query(
    `UPDATE transcriptions
        SET cancel_requested_at = COALESCE(cancel_requested_at, NOW()),
            cancel_reason = COALESCE(cancel_reason, $2),
            cancel_requested_by = COALESCE(cancel_requested_by, $4),
            budget_stop_state = CASE WHEN budget_stop_state = 'none' THEN 'requested' ELSE budget_stop_state END,
            updated_at = NOW()
      WHERE organization_id = $1${userFilter}
        AND status IN ('pending','queued','processing','analyzing','transcribed')
        AND budget_stop_state IN ('none','requested')
      RETURNING id`,
    scope === 'member'
      ? [...params, requestedBy]
      : [organizationId, reason, null, requestedBy],
  );
  const transcriptionIds = stopped.rows.map((row) => Number(row.id));
  await client.query(
    `INSERT INTO budget_stop_outbox
       (event_key, organization_id, user_id, period_start, reason, payload)
     VALUES ($1,$2,$3,$4::date,$5,$6::jsonb)
       ON CONFLICT (event_key) DO UPDATE
         SET state = CASE WHEN budget_stop_outbox.state = 'processed' THEN 'pending' ELSE budget_stop_outbox.state END,
             available_at = CASE WHEN budget_stop_outbox.state = 'processed' THEN NOW() ELSE budget_stop_outbox.available_at END,
             processed_at = CASE WHEN budget_stop_outbox.state = 'processed' THEN NULL ELSE budget_stop_outbox.processed_at END,
             revision = budget_stop_outbox.revision + 1,
             reason = EXCLUDED.reason,
             payload = EXCLUDED.payload,
             updated_at = NOW()`,
    [eventKey, organizationId, scope === 'member' ? userId : null, start, reason,
      JSON.stringify({
        scope,
        organizationId,
        userId: scope === 'member' ? userId : null,
        periodStart: start,
        transcriptionIds,
      })],
  );
  await logAuditEvent({
    userId: requestedBy,
    organizationId,
    action: 'budget.stop_requested',
    targetType: scope === 'member' ? 'user' : 'organization',
    targetId: String(scope === 'member' ? userId : organizationId),
    severity: 'warn',
    reason: auditReason,
    metadata: { scope, reason, periodStart: start, eventKey, transcriptionIds },
    client,
  });
}

export async function requestEmergencyBudgetStop({ organizationId, requestedBy, reason, at = new Date() }) {
  const normalizedReason = String(reason || '').trim();
  if (!normalizedReason || normalizedReason.length > 500) {
    throw Object.assign(new TypeError('An emergency-stop reason is required.'), { code: 'INVALID_BUDGET_INPUT' });
  }
  const start = periodStart(at);
  try {
    return await withTransaction(async (client) => {
      await lockPeriod(client, organizationId, start);
      await client.query(
        `UPDATE organization_budget_periods
            SET state = 'blocked', blocked_at = COALESCE(blocked_at, NOW()),
                version = version + 1, updated_at = NOW()
          WHERE organization_id = $1 AND period_start = $2::date`,
        [organizationId, start],
      );
      await requestBudgetStop(client, {
        organizationId,
        userId: null,
        start,
        scope: 'workspace',
        reason: `emergency_stop:${normalizedReason}`.slice(0, 120),
        requestedBy,
        auditReason: normalizedReason,
      });
      return { organizationId, periodStart: start, state: 'blocked' };
    });
  } catch (error) {
    if (error?.code === 'INVALID_BUDGET_INPUT') throw error;
    throw new BudgetAccountingUnavailableError(error);
  }
}

export async function requestTranscriptionBudgetStop({
  transcriptionId,
  organizationId,
  userId,
  requestedBy = null,
  reason,
  at = new Date(),
}) {
  const normalizedReason = String(reason || '').trim();
  if (!Number.isSafeInteger(Number(transcriptionId)) || !normalizedReason || normalizedReason.length > 120) {
    throw Object.assign(new TypeError('A transcription and stop reason are required.'), { code: 'INVALID_BUDGET_INPUT' });
  }
  const start = periodStart(at);
  try {
    return await withTransaction(async (client) => {
      await lockPeriod(client, organizationId, start);
      const stopped = await client.query(
        `UPDATE transcriptions
            SET cancel_requested_at = COALESCE(cancel_requested_at, NOW()),
                cancel_reason = COALESCE(cancel_reason, $4),
                cancel_requested_by = COALESCE(cancel_requested_by, $5),
                budget_stop_state = CASE WHEN budget_stop_state = 'none' THEN 'requested' ELSE budget_stop_state END,
                updated_at = NOW()
          WHERE id = $1 AND organization_id = $2 AND user_id = $3
            AND status IN ('pending','queued','processing','analyzing')
            AND budget_stop_state IN ('none','requested')
          RETURNING id`,
        [transcriptionId, organizationId, userId, normalizedReason, requestedBy],
      );
      if (!stopped.rowCount) {
        throw Object.assign(new Error('Transcription is outside the budget-stop scope.'), { code: 'INVALID_BUDGET_INPUT' });
      }
      const eventKey = `budget-stop:${organizationId}:${start}:transcription:${transcriptionId}`;
      await client.query(
        `INSERT INTO budget_stop_outbox
           (event_key, organization_id, user_id, period_start, reason, payload)
         VALUES ($1,$2,$3,$4::date,$5,$6::jsonb)
         ON CONFLICT (event_key) DO UPDATE
           SET state = CASE WHEN budget_stop_outbox.state = 'processed' THEN 'pending' ELSE budget_stop_outbox.state END,
               available_at = CASE WHEN budget_stop_outbox.state = 'processed' THEN NOW() ELSE budget_stop_outbox.available_at END,
               processed_at = CASE WHEN budget_stop_outbox.state = 'processed' THEN NULL ELSE budget_stop_outbox.processed_at END,
               revision = budget_stop_outbox.revision + 1,
               reason = EXCLUDED.reason,
               payload = EXCLUDED.payload,
               updated_at = NOW()`,
        [eventKey, organizationId, userId, start, normalizedReason,
          JSON.stringify({
            scope: 'transcription', organizationId, userId, transcriptionId,
            transcriptionIds: [Number(transcriptionId)], periodStart: start,
          })],
      );
      await logAuditEvent({
        userId: requestedBy,
        organizationId,
        action: 'budget.stop_requested',
        targetType: 'transcription',
        targetId: String(transcriptionId),
        severity: 'warn',
        metadata: { scope: 'transcription', reason: normalizedReason, periodStart: start, eventKey },
        client,
      });
      return { transcriptionId, organizationId, state: 'requested' };
    });
  } catch (error) {
    if (error?.code === 'INVALID_BUDGET_INPUT') throw error;
    throw new BudgetAccountingUnavailableError(error);
  }
}

export async function markProviderStarted(reservationId) {
  try {
    const result = await pool.query(
      `UPDATE budget_reservations
          SET provider_started_at = COALESCE(provider_started_at, NOW()), updated_at = NOW()
        WHERE id = $1 AND state = 'reserved'
        RETURNING *`,
      [reservationId],
    );
    if (!result.rowCount) {
      throw Object.assign(new Error('Reservation is not active.'), { code: 'RESERVATION_NOT_ACTIVE' });
    }
    return result.rows[0];
  } catch (error) {
    if (error?.code === 'RESERVATION_NOT_ACTIVE') throw error;
    throw new BudgetAccountingUnavailableError(error);
  }
}

export async function markAccountingPending(reservationId) {
  try {
    const result = await pool.query(
      `UPDATE budget_reservations
          SET accounting_pending_at = COALESCE(accounting_pending_at, NOW()), updated_at = NOW()
        WHERE id = $1 AND state = 'reserved'
        RETURNING *`,
      [reservationId],
    );
    return result.rows[0] || null;
  } catch (error) {
    throw new BudgetAccountingUnavailableError(error);
  }
}

export async function commitSpend(reservationId, {
  provider,
  model,
  usage = {},
  providerRequestId = null,
  idempotencyKey = null,
  createdAt = new Date(),
} = {}) {
  try {
    return await withTransaction(async (client) => {
      const reservationResult = await client.query('SELECT * FROM budget_reservations WHERE id = $1 FOR UPDATE', [reservationId]);
      if (!reservationResult.rowCount) throw Object.assign(new Error('Reservation not found.'), { code: 'RESERVATION_NOT_FOUND' });
      const reservation = reservationResult.rows[0];
      if (reservation.state === 'committed') {
        const existing = await client.query('SELECT * FROM usage_log WHERE id = $1', [reservation.usage_log_id]);
        return existing.rows[0] || null;
      }
      if (reservation.state !== 'reserved') throw Object.assign(new Error(`Reservation is ${reservation.state}.`), { code: 'RESERVATION_NOT_ACTIVE' });
      await lockPeriod(client, reservation.organization_id, reservation.period_start);
      const resolvedProvider = provider || inferProviderForModel(model);
      const price = await resolveProviderPrice({
        provider: resolvedProvider,
        model,
        operation: reservation.operation,
        organizationId: reservation.organization_id,
        at: createdAt,
        client,
      });
      let cost;
      try {
        cost = calculateUsageCost(price, usage);
      } catch (error) {
        if (error instanceof RangeError && !error.code) error.code = 'INVALID_USAGE_QUANTITY';
        throw error;
      }
      const usageKey = String(idempotencyKey || `reservation:${reservation.id}`);
      const inserted = await client.query(
        `INSERT INTO usage_log
           (user_id, organization_id, transcription_id, provider, model, operation,
            input_tokens, output_tokens, estimated_cost, price_version_id, price_override_id,
            pricing_currency, input_quantity, cached_input_quantity, cache_write_quantity,
            output_quantity, input_unit, output_unit, input_cost_micros,
            cached_input_cost_micros, cache_write_cost_micros, output_cost_micros,
            estimated_cost_micros, provider_request_id, idempotency_key, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
         RETURNING *`,
        [reservation.user_id, reservation.organization_id, reservation.transcription_id,
          resolvedProvider, model, reservation.operation, cost.inputQuantity, cost.outputQuantity,
          cost.estimatedCostMicros / 1_000_000, price.priceVersionId, price.priceOverrideId,
          price.currency, cost.inputQuantity, cost.cachedInputQuantity, cost.cacheWriteQuantity,
          cost.outputQuantity, price.input_unit, price.output_unit, cost.inputCostMicros,
          cost.cachedInputCostMicros, cost.cacheWriteCostMicros, cost.outputCostMicros,
          cost.estimatedCostMicros, providerRequestId, usageKey, new Date(createdAt).toISOString()],
      );
      await client.query(
        `UPDATE budget_reservations
            SET state = 'committed', committed_micros = $2, usage_log_id = $3,
                accounting_pending_at = NULL, updated_at = NOW()
          WHERE id = $1`,
        [reservation.id, cost.estimatedCostMicros, inserted.rows[0].id],
      );
      await client.query(
        `UPDATE organization_budget_periods
            SET committed_micros = committed_micros + $3,
                reserved_micros = GREATEST(0, reserved_micros - $4),
                version = version + 1, updated_at = NOW()
          WHERE organization_id = $1 AND period_start = $2::date`,
        [reservation.organization_id, reservation.period_start, cost.estimatedCostMicros, reservation.amount_micros],
      );

      const availability = await currentAvailability(
        client,
        reservation.organization_id,
        reservation.user_id,
        reservation.period_start,
        reservation.id,
      );
      const workspaceBlocked = availability.workspaceLimitMicros !== null && availability.workspaceRemainingMicros === 0;
      const memberBlocked = availability.memberLimitMicros !== null && availability.memberRemainingMicros === 0;
      if (workspaceBlocked) {
        await client.query(
          `UPDATE organization_budget_periods SET state = 'blocked', blocked_at = COALESCE(blocked_at, NOW()),
                  version = version + 1, updated_at = NOW()
            WHERE organization_id = $1 AND period_start = $2::date`,
          [reservation.organization_id, reservation.period_start],
        );
        await requestBudgetStop(client, {
          organizationId: reservation.organization_id, userId: reservation.user_id,
          start: reservation.period_start, scope: 'workspace', reason: 'hard_budget_workspace',
        });
      } else if (memberBlocked) {
        await requestBudgetStop(client, {
          organizationId: reservation.organization_id, userId: reservation.user_id,
          start: reservation.period_start, scope: 'member', reason: 'hard_budget_member',
        });
      }
      return inserted.rows[0];
    });
  } catch (error) {
    if (['RESERVATION_NOT_FOUND', 'RESERVATION_NOT_ACTIVE', 'PRICING_CONFIGURATION_MISSING',
      'INVALID_USAGE_QUANTITY'].includes(error?.code)) throw error;
    throw new BudgetAccountingUnavailableError(error);
  }
}

async function releaseReservation(client, reservation, state, { allowProviderStarted = false } = {}) {
  if (reservation.state !== 'reserved') return reservation;
  if (!allowProviderStarted && (reservation.provider_started_at || reservation.accounting_pending_at)) {
    return reservation;
  }
  await lockPeriod(client, reservation.organization_id, reservation.period_start);
  const updated = await client.query(
    `UPDATE budget_reservations SET state = $2, updated_at = NOW()
      WHERE id = $1 AND state = 'reserved' RETURNING *`,
    [reservation.id, state],
  );
  if (!updated.rowCount) return reservation;
  await client.query(
    `UPDATE organization_budget_periods
        SET reserved_micros = GREATEST(0, reserved_micros - $3), version = version + 1, updated_at = NOW()
      WHERE organization_id = $1 AND period_start = $2::date`,
    [reservation.organization_id, reservation.period_start, reservation.amount_micros],
  );
  return updated.rows[0];
}

export async function releaseSpend(reservationId, { state = 'released', allowProviderStarted = false } = {}) {
  if (!['released', 'expired'].includes(state)) throw Object.assign(new TypeError('Invalid release state.'), { code: 'INVALID_BUDGET_INPUT' });
  try {
    return await withTransaction(async (client) => {
      const result = await client.query('SELECT * FROM budget_reservations WHERE id = $1 FOR UPDATE', [reservationId]);
      if (!result.rowCount) return null;
      return releaseReservation(client, result.rows[0], state, { allowProviderStarted });
    });
  } catch (error) {
    throw new BudgetAccountingUnavailableError(error);
  }
}

export async function releaseSpendByIdempotencyKey({
  organizationId,
  userId,
  transcriptionId,
  idempotencyKey,
  speculativeOnly = false,
  allowProviderStarted = false,
  state = 'released',
}) {
  if (!['released', 'expired'].includes(state)) {
    throw Object.assign(new TypeError('Invalid release state.'), { code: 'INVALID_BUDGET_INPUT' });
  }
  try {
    return await withTransaction(async (client) => {
      const result = await client.query(
        `SELECT * FROM budget_reservations
          WHERE organization_id = $1 AND user_id = $2 AND transcription_id = $3
            AND idempotency_key = $4 AND ($5::boolean = FALSE OR speculative = TRUE)
          FOR UPDATE`,
        [organizationId, userId, transcriptionId, String(idempotencyKey || ''), speculativeOnly],
      );
      if (!result.rowCount) return null;
      return releaseReservation(client, result.rows[0], state, { allowProviderStarted });
    });
  } catch (error) {
    throw new BudgetAccountingUnavailableError(error);
  }
}

export async function releaseStaleReservations({ isTerminal, limit = 100 } = {}) {
  if (typeof isTerminal !== 'function') throw new TypeError('isTerminal callback is required.');
  const candidates = await pool.query(
    `SELECT * FROM budget_reservations
      WHERE state = 'reserved' AND expires_at < NOW()
        AND lifecycle_tracked_at IS NOT NULL
        AND provider_started_at IS NULL
        AND accounting_pending_at IS NULL
      ORDER BY expires_at ASC LIMIT $1`,
    [Math.min(500, Math.max(1, Number(limit) || 100))],
  );
  let released = 0;
  for (const reservation of candidates.rows) {
    // Expiry only makes a reservation eligible for reconciliation. Unknown
    // or non-terminal outcomes retain the hold until an explicit release.
    const safeToRelease = reservation.transcription_id === null
      || (await isTerminal(reservation)) === true;
    if (safeToRelease) {
      const result = await releaseSpend(reservation.id, { state: 'expired' });
      if (result?.state === 'expired') released += 1;
    }
  }
  return released;
}

export async function processNextBudgetStop(handleStop) {
  if (typeof handleStop !== 'function') throw new TypeError('handleStop callback is required.');
  const event = await withTransaction(async (client) => {
    const selected = await client.query(
      `SELECT * FROM budget_stop_outbox
        WHERE (state = 'pending' AND available_at <= NOW())
           OR (state = 'processing' AND locked_at < NOW() - INTERVAL '5 minutes')
        ORDER BY id ASC FOR UPDATE SKIP LOCKED LIMIT 1`,
    );
    if (!selected.rowCount) return null;
    const claimed = await client.query(
      `UPDATE budget_stop_outbox
          SET state = 'processing', attempts = attempts + 1, locked_at = NOW(), updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [selected.rows[0].id],
    );
    return claimed.rows[0];
  });
  if (!event) return null;
  try {
    const handled = await handleStop(event);
    const transcriptionIds = [...new Set(
      (Array.isArray(handled) ? handled : handled?.transcriptionIds || [])
        .map(Number)
        .filter(Number.isSafeInteger),
    )];
    await withTransaction(async (client) => {
      if (transcriptionIds.length) {
        await client.query(
          `UPDATE transcriptions SET budget_stop_state = 'stopped', status = 'cancelled',
                  bot_status = CASE WHEN source = 'vexa' THEN 'stopped_by_budget' ELSE bot_status END,
                  updated_at = NOW()
            WHERE organization_id = $1 AND id = ANY($2::integer[])
              AND budget_stop_state = 'requested'`,
          [event.organization_id, transcriptionIds],
        );
        await client.query(
          `UPDATE documents d
              SET status = 'budget_stopped', updated_at = NOW()
            FROM transcriptions t
            WHERE d.transcription_id = t.id AND t.organization_id = $1
              AND t.id = ANY($2::integer[]) AND t.budget_stop_state = 'stopped'`,
          [event.organization_id, transcriptionIds],
        );
      }
      const finalized = await client.query(
        `UPDATE budget_stop_outbox SET state = 'processed', processed_at = NOW(), locked_at = NULL,
                last_error = NULL, updated_at = NOW()
          WHERE id = $1 AND state = 'processing' AND attempts = $2 AND revision = $3`,
        [event.id, event.attempts, event.revision],
      );
      if (!finalized.rowCount) {
        await client.query(
          `UPDATE budget_stop_outbox
              SET state = 'pending', available_at = NOW(), processed_at = NULL,
                  locked_at = NULL, updated_at = NOW()
            WHERE id = $1 AND state = 'processing' AND attempts = $2`,
          [event.id, event.attempts],
        );
      }
    });
  } catch (error) {
    const lastError = String(error?.message || error).slice(0, 1000);
    // `prev` is read in the same snapshot as the UPDATE, so it still holds the
    // pre-update escalated_at and tells us whether this attempt is the one that
    // crossed the threshold — RETURNING alone would only show the new value.
    const requeued = await pool.query(
      `WITH prev AS (
         SELECT id, escalated_at FROM budget_stop_outbox WHERE id = $1
       )
       UPDATE budget_stop_outbox o
          SET state = 'pending',
              available_at = NOW() + ($4::bigint * INTERVAL '1 millisecond'),
              locked_at = NULL, last_error = $3, updated_at = NOW(),
              escalated_at = CASE
                WHEN o.escalated_at IS NULL AND o.attempts >= $5 THEN NOW()
                ELSE o.escalated_at END
         FROM prev
        WHERE o.id = prev.id AND o.state = 'processing' AND o.attempts = $2
        RETURNING o.attempts, o.reason, o.period_start, o.payload,
                  prev.escalated_at AS previous_escalated_at`,
      [event.id, event.attempts, lastError,
        stopRetryDelayMs(event.attempts, { baseMs: STOP_RETRY_BASE_MS, maxMs: STOP_RETRY_MAX_MS }),
        STOP_ESCALATE_AFTER_ATTEMPTS],
    );
    const row = requeued.rows[0];
    if (row && row.previous_escalated_at === null && Number(row.attempts) >= STOP_ESCALATE_AFTER_ATTEMPTS) {
      logError('budget_stop.escalated', error, {
        eventId: event.id,
        organizationId: event.organization_id,
        attempts: Number(row.attempts),
      });
      await logAuditEvent({
        organizationId: event.organization_id,
        userId: event.user_id,
        action: 'budget.stop_failing',
        targetType: row.payload?.scope === 'member' ? 'user' : 'organization',
        targetId: String(row.payload?.scope === 'member' ? event.user_id : event.organization_id),
        severity: 'error',
        metadata: {
          eventId: event.id,
          scope: row.payload?.scope || null,
          reason: row.reason,
          attempts: Number(row.attempts),
          lastError,
          transcriptionIds: row.payload?.transcriptionIds || [],
        },
      });
    }
    throw error;
  }
  return event;
}
