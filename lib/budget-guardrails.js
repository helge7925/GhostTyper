function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPositiveLimit(value) {
  const parsed = toNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

export function resolveEffectiveBudgetLimit({
  costLimit,
  memberMonthlyBudgetLimit,
}) {
  const accountLimit = toPositiveLimit(costLimit);
  const memberLimit = toPositiveLimit(memberMonthlyBudgetLimit);
  if (accountLimit === null && memberLimit === null) return null;
  if (accountLimit === null) return memberLimit;
  if (memberLimit === null) return accountLimit;
  return Math.min(accountLimit, memberLimit);
}

export function calculateBudgetTrafficLight({
  currentCost = 0,
  costLimit = null,
  estimatedNextCost = 0,
}) {
  const limit = toNumber(costLimit);
  const current = Math.max(0, toNumber(currentCost) || 0);
  const next = Math.max(0, toNumber(estimatedNextCost) || 0);

  if (limit === null || limit <= 0) {
    return {
      level: 'green',
      label: 'Kein Limit',
      message: 'Für diesen Account ist kein Kostenlimit gesetzt.',
      currentCost: current,
      projectedCost: current + next,
      limit: null,
      remaining: null,
      usageRatio: null,
      projectedRatio: null,
      willExceed: false,
      allowed: true,
    };
  }

  const remaining = Math.max(0, limit - current);
  const projectedCost = current + next;
  const usageRatio = current / limit;
  const projectedRatio = projectedCost / limit;
  const willExceed = projectedCost > limit;

  let level = 'green';
  let label = 'Niedriges Budget-Risiko';
  let message = 'Budget im sicheren Bereich.';

  if (willExceed || projectedRatio >= 0.95) {
    level = 'red';
    label = 'Budget kritisch';
    message = willExceed
      ? 'Diese Aktion würde das Monatsbudget überschreiten.'
      : 'Budget nahezu ausgeschöpft.';
  } else if (projectedRatio >= 0.75 || usageRatio >= 0.7) {
    level = 'yellow';
    label = 'Budget beobachten';
    message = 'Budget nähert sich dem Limit.';
  }

  return {
    level,
    label,
    message,
    currentCost: current,
    projectedCost,
    limit,
    remaining,
    usageRatio,
    projectedRatio,
    willExceed,
    allowed: !willExceed,
  };
}
