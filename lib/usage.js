import pool, { query } from './db';
import { logError } from './observability';
import { calculateBudgetTrafficLight } from './budget-guardrails';
import { calculateUsageCost, inferProviderForModel } from './pricing-core';
import { resolveProviderPrice } from './pricing-service';
import { getSelfUsage } from './budget-service';

// Legacy projection prices used only by pre-reservation estimate helpers and
// the model assistant. Accounting uses the versioned database catalog through
// resolveProviderPrice; these values must not be used for committed usage.
// Audio projections reuse token arguments: STT input is audio-seconds and TTS
// output is synthesized characters. Mistral Voxtral Mini Transcribe: $0.001/min ≈
// $0.0000167/s ≈ €0.0000155/s ≈ €15.50 per 1M audio seconds.
//
// Legacy `whisper-v3` rows kept for backwards-compatible cost tracking on
// historic Fireworks Whisper usage_log entries.
export const MODEL_PRICING = {
  // Cortecs serverless list prices in EUR per 1M tokens (cheapest routed
  // provider, cortecs.ai — checked 2026-07-16). Cortecs bills pass-through
  // with no token markup, so these are close to actual spend; the routing
  // `preference` can select a pricier provider for the same model.
  'deepseek-v4-pro':        { input: 1.553, output: 3.106 },
  'deepseek-v4-flash':      { input: 0.133, output: 0.266 },
  'kimi-k2.6':              { input: 0.694, output: 3.034 },
  'kimi-k2.7-code':         { input: 0.673, output: 3.142 },
  'minimax-m3':             { input: 0.355, output: 1.775 },
  // Legacy typo-id (the API only knows kimi-k2.6) kept so historic
  // usage_log rows still resolve a price entry.
  'kimi-2.6':               { input: 0.694, output: 3.034 },
  // Cortecs Whisper Large V3: 0.001667 €/min ≈ €27.78 per 1M audio seconds
  // (audio seconds are logged in input_tokens, see note above).
  'whisper-large-v3':       { input: 27.78, output: 0.00 },
  'voxtral-mini-latest':    { input: 15.50, output: 0.00 }, // Mistral Voxtral Mini (per audio second × 1M)
  // Realtime variant has the same per-minute price ($0.006/min) as
  // Voxtral Mini Standard — Mistral docs only the model-id changes.
  'voxtral-mini-transcribe-realtime-2602': { input: 15.50, output: 0.00 },
  // Voxtral TTS — officially billed at $16 per 1M synthesized text
  // characters. Characters are logged in output_tokens so estimateCost can
  // use the same generic calculation. input=0 because there is no separate
  // request-text charge.
  // Voxtral TTS GA model (March 2026). Mistral has not published a
  // `-latest` alias yet; the dated tag is what the API accepts.
  'voxtral-mini-tts-2603':  { input: 0.00,  output: 16.00 },
  // Legacy alias kept so usage rows logged before the model rename still
  // resolve a price entry instead of warning about "unknown model".
  'voxtral-tts-latest':     { input: 0.00,  output: 16.00 },
  'mistral-large-latest':   { input: 2.00,  output: 6.00 },
  'mistral-medium-latest':  { input: 0.75,  output: 2.25 },
  'mistral-small-latest':   { input: 0.20,  output: 0.60 },
  'whisper-v3':             { input: 56.00, output: 0.00 }, // legacy Fireworks Whisper-Large-v3
};

export class CostLimitExceededError extends Error {
  constructor(currentCost, limit) {
    super(`Monatliches Kostenlimit erreicht (${currentCost.toFixed(2)} / ${limit.toFixed(2)} EUR)`);
    this.name = 'CostLimitExceededError';
    this.code = 'COST_LIMIT_EXCEEDED';
    this.currentCost = Number(currentCost);
    this.limit = Number(limit);
  }
}

export class BudgetGuardrailExceededError extends Error {
  constructor(currentCost, limit, estimatedNextCost = 0) {
    const projected = currentCost + estimatedNextCost;
    super(
      `Budget-Guardrail greift (${projected.toFixed(2)} / ${limit.toFixed(2)} EUR prognostiziert).`
    );
    this.name = 'BudgetGuardrailExceededError';
    this.code = 'BUDGET_GUARDRAIL_EXCEEDED';
    this.currentCost = Number(currentCost);
    this.limit = Number(limit);
    this.estimatedNextCost = Number(estimatedNextCost);
    this.projectedCost = Number(projected);
  }
}

export class CostLimitCheckUnavailableError extends Error {
  constructor(message = 'Kostenlimit kann derzeit nicht geprüft werden. Bitte erneut versuchen.') {
    super(message);
    this.name = 'CostLimitCheckUnavailableError';
    this.code = 'COST_CHECK_UNAVAILABLE';
  }
}

function toAdvisoryLockKey(userId) {
  const parsed = Number.parseInt(userId, 10);
  if (Number.isFinite(parsed)) return parsed;
  // Stable per-user hash for non-numeric ids so unrelated users never
  // serialize on a shared lock key.
  let hash = 0;
  for (const char of String(userId)) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return hash;
}

/**
 * Calculate estimated cost from token usage.
 */
export function estimateCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['deepseek-v4-pro'];
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export function estimateTextTransformCost(model, text, {
  inputBufferTokens = 80,
  outputMultiplier = 0.7,
  outputBufferTokens = 120,
} = {}) {
  const chars = typeof text === 'string' ? text.length : 0;
  const inputTokens = Math.max(1, Math.ceil(chars / 4)) + inputBufferTokens;
  const outputTokens = Math.max(1, Math.ceil((chars / 4) * outputMultiplier + outputBufferTokens));
  return estimateCost(model, inputTokens, outputTokens);
}

/**
 * Log API usage to the usage_log table. The `organizationId` arg is
 * optional for backwards-compat (older call sites still call with the
 * 4-arg signature); when present, the row is also tagged with the org so
 * usage dashboards can aggregate per workspace.
 */
export async function logUsage(userId, model, operation, usage = {}, organizationId = null, context = {}) {
  const provider = context.provider || inferProviderForModel(model);

  try {
    const price = await resolveProviderPrice({ provider, model, operation, organizationId });
    const cost = calculateUsageCost(price, usage);
    await query(
      `INSERT INTO usage_log
         (user_id, organization_id, transcription_id, provider, model, operation,
          input_tokens, output_tokens, estimated_cost, price_version_id, price_override_id,
          pricing_currency, input_quantity, cached_input_quantity, cache_write_quantity,
          output_quantity, input_unit, output_unit, input_cost_micros,
          cached_input_cost_micros, cache_write_cost_micros, output_cost_micros,
          estimated_cost_micros, provider_request_id, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
      [userId, organizationId || null, context?.transcriptionId || null, provider, model, operation,
        cost.inputQuantity, cost.outputQuantity, cost.estimatedCostMicros / 1_000_000,
        price.priceVersionId, price.priceOverrideId, price.currency,
        cost.inputQuantity, cost.cachedInputQuantity, cost.cacheWriteQuantity, cost.outputQuantity,
        price.input_unit, price.output_unit, cost.inputCostMicros, cost.cachedInputCostMicros,
        cost.cacheWriteCostMicros, cost.outputCostMicros, cost.estimatedCostMicros,
        context.providerRequestId || null, context.idempotencyKey || null],
    );
  } catch (error) {
    logError('usage.log_failed', error);
    throw error;
  }
}

/**
 * Compatibility gate for call sites not yet converted to reservations. It
 * reads only workspace-scoped canonical budgets and derives the effective
 * availability from workspace spend and this member's spend independently.
 */
export async function checkCostLimit(userId, organizationId = null) {
  try {
    if (!organizationId) {
      return {
        allowed: true,
        currentCost: 0,
        limit: null,
        accountLimit: null,
        memberLimit: null,
        organizationLimit: null,
        trafficLight: calculateBudgetTrafficLight({ currentCost: 0, costLimit: null }),
      };
    }
    const self = await getSelfUsage(organizationId, userId);
    const currentCost = self.ownCostMicros / 1_000_000;
    const remaining = self.effectiveRemainingMicros === null ? null : self.effectiveRemainingMicros / 1_000_000;
    const limit = remaining === null ? null : currentCost + remaining;
    return {
      allowed: remaining === null || remaining > 0,
      currentCost,
      limit,
      remaining,
      accountLimit: null,
      memberLimit: self.memberLimitMicros === null ? null : self.memberLimitMicros / 1_000_000,
      organizationLimit: null,
      trafficLight: calculateBudgetTrafficLight({
        currentCost,
        costLimit: limit,
        estimatedNextCost: 0,
      }),
    };
  } catch (error) {
    logError('usage.cost_limit_check_failed', error);
    const wrappedError = new CostLimitCheckUnavailableError();
    wrappedError.cause = error;
    throw wrappedError;
  }
}

export async function enforceProjectedBudgetGuardrail(userId, estimatedAdditionalCost = 0, organizationId = null) {
  const costState = await checkCostLimit(userId, organizationId);
  if (costState.limit === null || costState.limit === undefined) {
    return {
      ...costState,
      projectedCost: costState.currentCost + estimatedAdditionalCost,
      allowedProjected: true,
      trafficLight: calculateBudgetTrafficLight({
        currentCost: costState.currentCost,
        costLimit: null,
        estimatedNextCost: estimatedAdditionalCost,
      }),
    };
  }

  const trafficLight = calculateBudgetTrafficLight({
    currentCost: costState.currentCost,
    costLimit: costState.limit,
    estimatedNextCost: estimatedAdditionalCost,
  });

  if (!trafficLight.allowed) {
    throw new BudgetGuardrailExceededError(
      costState.currentCost,
      costState.limit,
      estimatedAdditionalCost
    );
  }

  return {
    ...costState,
    projectedCost: trafficLight.projectedCost,
    allowedProjected: true,
    trafficLight,
  };
}

/**
 * Serialized budget gate: takes the per-user advisory lock only for the
 * duration of the limit check (plus the optional cost projection), then
 * releases lock and pool connection again. Long-running provider calls must
 * run OUTSIDE this gate — holding the lock through a multi-minute
 * transcription pins a pool connection and blocks every other paid action
 * of the same user. Trade-off: two concurrent requests of one user can both
 * pass the gate before either logs usage; the overspend is bounded by a
 * single request.
 */
export async function assertBudgetWithinLimits(userId, organizationId = null, estimatedAdditionalCost = 0) {
  return withUserCostLock(userId, async () => {
    const costCheck = await checkCostLimit(userId, organizationId);
    if (!costCheck.allowed) {
      throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
    }
    if (estimatedAdditionalCost > 0) {
      return enforceProjectedBudgetGuardrail(userId, estimatedAdditionalCost, organizationId);
    }
    return costCheck;
  });
}

export async function withUserCostLock(userId, callback) {
  const lockKey = toAdvisoryLockKey(userId);
  const client = await pool.connect();
  let locked = false;

  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [lockKey]);
    locked = true;
    return await callback();
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [lockKey]).catch(() => {});
    }
    client.release();
  }
}
