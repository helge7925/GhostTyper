import { calculateBudgetTrafficLight } from './budget-guardrails.js';

const GOAL_SORT = Object.freeze({
  balanced: 'most-popular',
  cost: 'pricing-low-to-high',
  quality: 'intelligence-high-to-low',
  speed: 'latency-low-to-high',
});

export function normalizeOptimizationGoal(goal) {
  const normalized = String(goal || '').trim().toLowerCase();
  return GOAL_SORT[normalized] ? normalized : 'balanced';
}

export function openRouterSortForGoal(goal) {
  return GOAL_SORT[normalizeOptimizationGoal(goal)];
}

function workloadFor({ inputText, fileSizeBytes, taskType, includePostAnalysis }) {
  const textTokens = Math.max(1, Math.ceil(String(inputText || '').length / 4));
  if (taskType === 'transcription-analysis') {
    const minutes = Math.max(0.25, Number(fileSizeBytes || 0) / (16 * 1024 * 60));
    const transcriptTokens = Math.ceil(minutes * 220);
    return {
      inputTokens: includePostAnalysis ? transcriptTokens + 140 : 1,
      outputTokens: includePostAnalysis ? Math.ceil(transcriptTokens * 0.45) : 1,
      breakdown: { transcription: { minutes }, analysis: includePostAnalysis ? { inputTokens: transcriptTokens + 140 } : null },
    };
  }
  return {
    inputTokens: textTokens + 80,
    outputTokens: Math.ceil(textTokens * (taskType === 'translation' ? 1.1 : 0.7) + 120),
    breakdown: { text: { inputTokens: textTokens + 80 } },
  };
}

function estimatedCost(model, workload) {
  const input = Number(model?.pricing?.prompt);
  const output = Number(model?.pricing?.completion);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return workload.inputTokens * input + workload.outputTokens * output;
}

export function recommendModelPlan({
  taskType,
  goal,
  inputText,
  fileSizeBytes,
  includePostAnalysis,
  models = [],
  currentCost,
  costLimit,
}) {
  const normalizedGoal = normalizeOptimizationGoal(goal);
  const workload = workloadFor({ taskType, inputText, fileSizeBytes, includePostAnalysis });
  const budgetRemaining = Number.isFinite(Number(costLimit))
    ? Math.max(0, Number(costLimit) - Number(currentCost || 0))
    : null;
  const options = models.map((model, index) => {
    const cost = estimatedCost(model, workload);
    return {
      model: model.id,
      label: model.name || model.id,
      estimatedCost: cost,
      estimatedInputTokens: workload.inputTokens,
      estimatedOutputTokens: workload.outputTokens,
      withinBudget: cost === null || budgetRemaining === null || cost <= budgetRemaining,
      score: Number((1 / (index + 1)).toFixed(4)),
    };
  });
  if (!options.length) throw Object.assign(new Error('Kein freigegebenes kompatibles Modell verfügbar.'), { code: 'MODEL_UNAVAILABLE' });
  const recommended = options.find((option) => option.withinBudget) || options[0];
  const baseBudget = {
    currentCost: Number.isFinite(Number(currentCost)) ? Number(currentCost) : 0,
    costLimit: Number.isFinite(Number(costLimit)) ? Number(costLimit) : null,
  };
  return {
    taskType,
    goal: normalizedGoal,
    sort: GOAL_SORT[normalizedGoal],
    recommendedModel: recommended.model,
    reason: `${recommended.label} ist die höchstplatzierte freigegebene Option der aktuellen OpenRouter-Sortierung.`,
    estimatedInputTokens: workload.inputTokens,
    estimatedOutputTokens: workload.outputTokens,
    estimatedCost: recommended.estimatedCost,
    fixedCost: 0,
    breakdown: workload.breakdown,
    budget: {
      ...baseBudget,
      remaining: budgetRemaining,
      trafficLight: calculateBudgetTrafficLight({ ...baseBudget, estimatedNextCost: 0 }),
    },
    trafficLight: calculateBudgetTrafficLight({ ...baseBudget, estimatedNextCost: recommended.estimatedCost || 0 }),
    options: options.map((option) => ({
      ...option,
      fixedCost: 0,
      variableCost: option.estimatedCost,
      trafficLight: calculateBudgetTrafficLight({ ...baseBudget, estimatedNextCost: option.estimatedCost || 0 }),
    })),
  };
}
