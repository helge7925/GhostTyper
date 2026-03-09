import pool, { query } from './db';
import { logError } from './observability';
import { calculateBudgetTrafficLight, resolveEffectiveBudgetLimit } from './budget-guardrails';

// Mistral pricing per 1M tokens (EUR, approximate)
export const MODEL_PRICING = {
  'voxtral-mini-latest':    { input: 0.01,  output: 0.01 },  // audio transcription (flat per-minute pricing varies)
  'voxtral-mini-transcribe-realtime-26-02': { input: 0.01, output: 0.01 },
  'mistral-large-latest':   { input: 2.00,  output: 6.00 },
  'mistral-medium-latest':  { input: 0.75,  output: 2.25 },
  'mistral-small-latest':   { input: 0.20,  output: 0.60 },
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
  return 0;
}

/**
 * Calculate estimated cost from token usage.
 */
export function estimateCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['mistral-large-latest'];
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
 * Log API usage to the usage_log table.
 */
export async function logUsage(userId, model, operation, usage = {}) {
  const inputTokens = usage.prompt_tokens || usage.input_tokens || 0;
  const outputTokens = usage.completion_tokens || usage.output_tokens || 0;
  const cost = estimateCost(model, inputTokens, outputTokens);

  try {
    await query(
      `INSERT INTO usage_log (user_id, model, operation, input_tokens, output_tokens, estimated_cost)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, model, operation, inputTokens, outputTokens, cost]
    );
  } catch (error) {
    logError('usage.log_failed', error);
  }
}

/**
 * Check if user has exceeded their monthly cost limit.
 * Returns { allowed: boolean, currentCost: number, limit: number|null }
 */
export async function checkCostLimit(userId) {
  try {
    const settingsResult = await query(
      'SELECT cost_limit, member_monthly_budget_limit FROM settings WHERE user_id = $1',
      [userId]
    );

    const accountLimit = settingsResult.rows[0]?.cost_limit;
    const memberLimit = settingsResult.rows[0]?.member_monthly_budget_limit;
    const limit = resolveEffectiveBudgetLimit({
      costLimit: accountLimit,
      memberMonthlyBudgetLimit: memberLimit,
    });
    if (limit === null || limit === undefined) {
      return {
        allowed: true,
        currentCost: 0,
        limit: null,
        accountLimit: null,
        memberLimit: null,
        trafficLight: calculateBudgetTrafficLight({ currentCost: 0, costLimit: null }),
      };
    }

    const usageResult = await query(
      `SELECT COALESCE(SUM(estimated_cost), 0) AS total_cost
       FROM usage_log
       WHERE user_id = $1
         AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)`,
      [userId]
    );

    const currentCost = parseFloat(usageResult.rows[0].total_cost);
    return {
      allowed: currentCost < parseFloat(limit),
      currentCost,
      limit: parseFloat(limit),
      accountLimit: accountLimit !== null && accountLimit !== undefined ? parseFloat(accountLimit) : null,
      memberLimit: memberLimit !== null && memberLimit !== undefined ? parseFloat(memberLimit) : null,
      trafficLight: calculateBudgetTrafficLight({
        currentCost,
        costLimit: parseFloat(limit),
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

export async function enforceProjectedBudgetGuardrail(userId, estimatedAdditionalCost = 0) {
  const costState = await checkCostLimit(userId);
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
