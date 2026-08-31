function optionalLimit(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function calculateBudgetAvailability({
  workspaceLimitMicros = null,
  memberLimitMicros = null,
  workspaceCommittedMicros = 0,
  workspaceReservedMicros = 0,
  memberCommittedMicros = 0,
  memberReservedMicros = 0,
} = {}) {
  const workspaceLimit = optionalLimit(workspaceLimitMicros);
  const memberLimit = optionalLimit(memberLimitMicros);
  const workspaceRemainingMicros = workspaceLimit === null
    ? null
    : Math.max(0, workspaceLimit - Number(workspaceCommittedMicros) - Number(workspaceReservedMicros));
  const memberRemainingMicros = memberLimit === null
    ? null
    : Math.max(0, memberLimit - Number(memberCommittedMicros) - Number(memberReservedMicros));
  const finite = [workspaceRemainingMicros, memberRemainingMicros].filter((value) => value !== null);

  return {
    workspaceLimitMicros: workspaceLimit,
    memberLimitMicros: memberLimit,
    workspaceRemainingMicros,
    memberRemainingMicros,
    effectiveRemainingMicros: finite.length ? Math.min(...finite) : null,
  };
}

export function budgetLevel({ costMicros = 0, limitMicros = null } = {}) {
  const limit = optionalLimit(limitMicros);
  if (limit === null) return 'green';
  const ratio = Math.max(0, Number(costMicros)) / limit;
  if (ratio >= 0.95) return 'red';
  if (ratio >= 0.70) return 'yellow';
  return 'green';
}

function patchLimit(value, field, { centsBacked = false } = {}) {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0
      || (centsBacked && (parsed % 10_000 !== 0 || parsed / 10_000 > 2_147_483_647))) {
    throw Object.assign(new TypeError(`${field} must be a positive integer${centsBacked ? ' in whole cents' : ''}.`), {
      code: 'INVALID_BUDGET_INPUT',
    });
  }
  return parsed;
}

export function normalizeBudgetPatch(input = {}) {
  const reason = String(input.reason || '').trim();
  if (!reason || reason.length > 500) {
    throw Object.assign(new TypeError('A budget change reason is required.'), { code: 'INVALID_BUDGET_INPUT' });
  }
  const output = { reason };
  if (Object.prototype.hasOwnProperty.call(input, 'workspaceLimitMicros')) {
    output.workspaceLimitMicros = patchLimit(input.workspaceLimitMicros, 'workspaceLimitMicros', { centsBacked: true });
  }
  if (Object.prototype.hasOwnProperty.call(input, 'defaultMemberLimitMicros')) {
    output.defaultMemberLimitMicros = patchLimit(input.defaultMemberLimitMicros, 'defaultMemberLimitMicros', { centsBacked: true });
  }
  if (Object.prototype.hasOwnProperty.call(input, 'member')) {
    const userId = Number(input.member?.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0 || !Object.prototype.hasOwnProperty.call(input.member || {}, 'monthlyLimitMicros')) {
      throw Object.assign(new TypeError('member userId and monthlyLimitMicros are required.'), { code: 'INVALID_BUDGET_INPUT' });
    }
    output.member = {
      userId,
      monthlyLimitMicros: patchLimit(input.member.monthlyLimitMicros, 'member.monthlyLimitMicros'),
    };
  }
  if (!Object.prototype.hasOwnProperty.call(output, 'workspaceLimitMicros')
      && !Object.prototype.hasOwnProperty.call(output, 'defaultMemberLimitMicros')
      && !output.member) {
    throw Object.assign(new TypeError('No budget fields were supplied.'), { code: 'INVALID_BUDGET_INPUT' });
  }
  return output;
}
