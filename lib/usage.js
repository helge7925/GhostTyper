import { query } from './db';

// Mistral pricing per 1M tokens (EUR, approximate)
const MODEL_PRICING = {
  'voxtral-mini-latest':    { input: 0.01,  output: 0.01 },  // audio transcription (flat per-minute pricing varies)
  'mistral-large-latest':   { input: 2.00,  output: 6.00 },
  'mistral-medium-latest':  { input: 0.75,  output: 2.25 },
  'mistral-small-latest':   { input: 0.20,  output: 0.60 },
};

/**
 * Calculate estimated cost from token usage.
 */
function estimateCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['mistral-large-latest'];
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
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
    console.error('Usage logging failed:', error);
  }
}

/**
 * Check if user has exceeded their monthly cost limit.
 * Returns { allowed: boolean, currentCost: number, limit: number|null }
 */
export async function checkCostLimit(userId) {
  try {
    const settingsResult = await query(
      'SELECT cost_limit FROM settings WHERE user_id = $1',
      [userId]
    );

    const limit = settingsResult.rows[0]?.cost_limit;
    if (!limit) return { allowed: true, currentCost: 0, limit: null };

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
    };
  } catch (error) {
    console.error('Cost limit check failed:', error);
    return { allowed: true, currentCost: 0, limit: null };
  }
}
