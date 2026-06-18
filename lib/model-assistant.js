import { estimateCost } from './usage';
import { calculateBudgetTrafficLight } from './budget-guardrails';

const MODEL_META = {
  'deepseek-v4-pro': {
    label: 'Cortecs DeepSeek V4 Pro',
    quality: 10,
    speed: 7,
  },
  'whisper-large-v3': {
    label: 'Cortecs Whisper Large v3',
    quality: 9,
    speed: 6,
  },
  'mistral-large-latest': {
    label: 'Mistral Large',
    quality: 10,
    speed: 4,
  },
  'mistral-medium-latest': {
    label: 'Mistral Medium',
    quality: 8,
    speed: 7,
  },
  'mistral-small-latest': {
    label: 'Mistral Small',
    quality: 6,
    speed: 9,
  },
  'voxtral-mini-latest': {
    label: 'Voxtral Mini',
    quality: 7,
    speed: 9,
  },
};

const CHAT_CANDIDATES = [
  'deepseek-v4-pro',
  'mistral-small-latest',
  'mistral-medium-latest',
  'mistral-large-latest',
];

const GOAL_WEIGHTS = {
  balanced: { quality: 0.4, speed: 0.3, cost: 0.3 },
  cost: { quality: 0.15, speed: 0.2, cost: 0.65 },
  quality: { quality: 0.65, speed: 0.1, cost: 0.25 },
  speed: { quality: 0.15, speed: 0.65, cost: 0.2 },
};

export function normalizeOptimizationGoal(goal) {
  if (!goal || typeof goal !== 'string') return 'balanced';
  const normalized = goal.trim().toLowerCase();
  return GOAL_WEIGHTS[normalized] ? normalized : 'balanced';
}

function estimateTokensFromText(text) {
  const safeText = typeof text === 'string' ? text : '';
  const chars = safeText.length;
  return Math.max(1, Math.ceil(chars / 4));
}

function estimateMinutesFromFileSize(fileSizeBytes) {
  const size = Number(fileSizeBytes);
  if (!Number.isFinite(size) || size <= 0) return 1;

  // Approximation: 16KB/s ~ 128kbit/s audio stream.
  return Math.max(0.25, size / (16 * 1024 * 60));
}

function estimateWorkload({ taskType, inputText, fileSizeBytes, includePostAnalysis = false }) {
  const inputTokens = estimateTokensFromText(inputText);

  if (taskType === 'translation') {
    return {
      inputTokens: inputTokens + 80,
      outputTokens: Math.ceil(inputTokens * 1.1),
      fixedCost: 0,
      breakdown: {
        translation: {
          inputTokens: inputTokens + 80,
          outputTokens: Math.ceil(inputTokens * 1.1),
        },
      },
    };
  }

  if (taskType === 'transcription-analysis') {
    const minutes = estimateMinutesFromFileSize(fileSizeBytes);
    const transcriptionOutputTokens = Math.ceil(minutes * 220);
    const transcriptionCost = estimateCost('whisper-large-v3', transcriptionOutputTokens, 0);

    if (!includePostAnalysis) {
      return {
        inputTokens: 0,
        outputTokens: 0,
        fixedCost: transcriptionCost,
        breakdown: {
          transcription: {
            minutes,
            inputTokens: 0,
            outputTokens: transcriptionOutputTokens,
            estimatedCost: transcriptionCost,
          },
        },
      };
    }

    const analysisInput = transcriptionOutputTokens + 140;
    const analysisOutput = Math.ceil(transcriptionOutputTokens * 0.45);

    return {
      inputTokens: analysisInput,
      outputTokens: analysisOutput,
      fixedCost: transcriptionCost,
      breakdown: {
        transcription: {
          minutes,
          inputTokens: 0,
          outputTokens: transcriptionOutputTokens,
          estimatedCost: transcriptionCost,
        },
        analysis: {
          inputTokens: analysisInput,
          outputTokens: analysisOutput,
        },
      },
    };
  }

  return {
    inputTokens: inputTokens + 80,
    outputTokens: Math.ceil(inputTokens * 0.7 + 120),
    fixedCost: 0,
    breakdown: {
      text: {
        inputTokens: inputTokens + 80,
        outputTokens: Math.ceil(inputTokens * 0.7 + 120),
      },
    },
  };
}

function getCandidatesForTask(taskType) {
  if (taskType === 'transcription') {
    return ['whisper-large-v3'];
  }
  return CHAT_CANDIDATES;
}

function buildRecommendationReason(goal, model, budget) {
  const label = MODEL_META[model]?.label || model;

  if (budget?.remaining !== null && budget?.remaining !== undefined && budget.remaining <= 0) {
    return `${label} wurde gewählt, weil Ihr Budget bereits erreicht ist und das Modell die günstigste Option ist.`;
  }

  if (goal === 'cost') {
    return `${label} wurde als kosteneffizienteste Option für diese Aufgabe bewertet.`;
  }
  if (goal === 'quality') {
    return `${label} wurde für die höchste Ergebnisqualität priorisiert.`;
  }
  if (goal === 'speed') {
    return `${label} wurde für die schnellste Verarbeitung priorisiert.`;
  }

  return `${label} ist der ausgewogene Kompromiss aus Qualität, Geschwindigkeit und Kosten.`;
}

export function recommendModelPlan({
  taskType,
  goal,
  inputText,
  fileSizeBytes,
  includePostAnalysis,
  preferredModel,
  currentCost,
  costLimit,
}) {
  const normalizedGoal = normalizeOptimizationGoal(goal);
  const candidates = getCandidatesForTask(taskType);
  const workload = estimateWorkload({
    taskType,
    inputText,
    fileSizeBytes,
    includePostAnalysis,
  });

  const options = candidates.map((model) => {
    const variableCost = estimateCost(model, workload.inputTokens, workload.outputTokens);
    const totalCost = variableCost + workload.fixedCost;
    return {
      model,
      label: MODEL_META[model]?.label || model,
      estimatedInputTokens: workload.inputTokens,
      estimatedOutputTokens: workload.outputTokens,
      fixedCost: workload.fixedCost,
      variableCost,
      estimatedCost: totalCost,
      quality: MODEL_META[model]?.quality || 5,
      speed: MODEL_META[model]?.speed || 5,
    };
  });

  const costValues = options.map((option) => option.estimatedCost);
  const minCost = Math.min(...costValues);
  const maxCost = Math.max(...costValues);
  const weights = GOAL_WEIGHTS[normalizedGoal];

  const budgetRemaining = Number.isFinite(Number(costLimit))
    ? Math.max(0, Number(costLimit) - Number(currentCost || 0))
    : null;

  const scored = options.map((option) => {
    const costNormalized = maxCost === minCost
      ? 1
      : 1 - ((option.estimatedCost - minCost) / (maxCost - minCost));

    const qualityNormalized = option.quality / 10;
    const speedNormalized = option.speed / 10;

    let budgetPenalty = 0;
    if (budgetRemaining !== null && option.estimatedCost > budgetRemaining) {
      budgetPenalty = 0.4;
    }

    const score = (qualityNormalized * weights.quality)
      + (speedNormalized * weights.speed)
      + (costNormalized * weights.cost)
      - budgetPenalty;

    return {
      ...option,
      score,
      withinBudget: budgetRemaining === null ? true : option.estimatedCost <= budgetRemaining,
    };
  }).sort((a, b) => b.score - a.score);

  let recommended = scored[0];

  if (budgetRemaining !== null && budgetRemaining <= 0) {
    recommended = scored.slice().sort((a, b) => a.estimatedCost - b.estimatedCost)[0];
  }

  if (preferredModel && scored.some((entry) => entry.model === preferredModel) && normalizedGoal === 'balanced') {
    const preferredEntry = scored.find((entry) => entry.model === preferredModel);
    const scoreGap = scored[0].score - preferredEntry.score;
    if (scoreGap <= 0.08) {
      recommended = preferredEntry;
    }
  }

  const recommendationTrafficLight = calculateBudgetTrafficLight({
    currentCost: Number.isFinite(Number(currentCost)) ? Number(currentCost) : 0,
    costLimit: Number.isFinite(Number(costLimit)) ? Number(costLimit) : null,
    estimatedNextCost: recommended.estimatedCost,
  });

  return {
    taskType,
    goal: normalizedGoal,
    recommendedModel: recommended.model,
    reason: buildRecommendationReason(normalizedGoal, recommended.model, {
      remaining: budgetRemaining,
    }),
    estimatedInputTokens: recommended.estimatedInputTokens,
    estimatedOutputTokens: recommended.estimatedOutputTokens,
    estimatedCost: recommended.estimatedCost,
    fixedCost: recommended.fixedCost,
    breakdown: workload.breakdown,
    budget: {
      currentCost: Number.isFinite(Number(currentCost)) ? Number(currentCost) : 0,
      costLimit: Number.isFinite(Number(costLimit)) ? Number(costLimit) : null,
      remaining: budgetRemaining,
      trafficLight: calculateBudgetTrafficLight({
        currentCost: Number.isFinite(Number(currentCost)) ? Number(currentCost) : 0,
        costLimit: Number.isFinite(Number(costLimit)) ? Number(costLimit) : null,
        estimatedNextCost: 0,
      }),
    },
    trafficLight: recommendationTrafficLight,
    options: scored.map((entry) => ({
      model: entry.model,
      label: entry.label,
      estimatedCost: entry.estimatedCost,
      fixedCost: entry.fixedCost,
      variableCost: entry.variableCost,
      estimatedInputTokens: entry.estimatedInputTokens,
      estimatedOutputTokens: entry.estimatedOutputTokens,
      withinBudget: entry.withinBudget,
      score: Number(entry.score.toFixed(4)),
      trafficLight: calculateBudgetTrafficLight({
        currentCost: Number.isFinite(Number(currentCost)) ? Number(currentCost) : 0,
        costLimit: Number.isFinite(Number(costLimit)) ? Number(costLimit) : null,
        estimatedNextCost: entry.estimatedCost,
      }),
    })),
  };
}
