const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const MAX_OFFSET = 10_000;

function pickFirst(value) {
  return Array.isArray(value) ? value[0] : value;
}

function parseIntInRange(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function parseTranscriptionsListParams(queryParams = {}) {
  const rawSearch = String(pickFirst(queryParams.search) || '').trim();
  const scopeValue = String(pickFirst(queryParams.scope) || '').trim().toLowerCase();
  const scope = scopeValue === 'full' ? 'full' : 'name';
  const limit = parseIntInRange(pickFirst(queryParams.limit), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = parseIntInRange(pickFirst(queryParams.offset), 0, 0, MAX_OFFSET);

  return {
    search: rawSearch.slice(0, 200),
    scope,
    limit,
    offset,
  };
}
