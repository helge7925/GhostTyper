export function parseLiveUsageScope(query = {}) {
  const raw = query.meetingId ?? query.transcriptionId;
  if (Array.isArray(raw) || raw === null || raw === undefined || raw === '') {
    throw new Error('USAGE_SCOPE_REQUIRED');
  }
  const transcriptionId = Number.parseInt(String(raw), 10);
  if (!Number.isSafeInteger(transcriptionId) || transcriptionId < 1 || String(transcriptionId) !== String(raw).trim()) {
    throw new Error('USAGE_SCOPE_INVALID');
  }
  return { transcriptionId, scope: query.meetingId !== undefined ? 'meeting' : 'transcription' };
}

export function buildLiveUsagePayload({ usageRow = {}, transcription = {}, now = new Date(), staleAfterMs = 45_000 }) {
  const status = String(transcription.status || '').toLowerCase();
  const finished = ['completed', 'transcribed', 'error', 'cancelled', 'canceled'].includes(status)
    || Boolean(transcription.meeting_ended_at);
  const lastUsageAt = usageRow.last_usage_at ? new Date(usageRow.last_usage_at) : null;
  const stale = !finished && lastUsageAt && now.valueOf() - lastUsageAt.valueOf() > staleAfterMs;
  return {
    transcriptionId: Number(transcription.id),
    totalCost: Number(usageRow.total_cost || 0),
    totalRequests: Number(usageRow.total_requests || 0),
    lastUsageAt: lastUsageAt?.toISOString() || null,
    state: finished ? 'finished' : stale ? 'stale' : 'active',
    finished,
  };
}

export function shouldPollLiveUsage({ canViewCost, transcriptionId, finished = false }) {
  return Boolean(canViewCost && Number(transcriptionId) > 0 && !finished);
}

export function withLiveUsageBudget(payload, costState) {
  return {
    ...payload,
    effectiveLimit: costState?.limit ?? null,
    budgetTrafficLight: costState?.trafficLight ?? null,
  };
}
