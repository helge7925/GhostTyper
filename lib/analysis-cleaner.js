const KNOWN_PLACEHOLDERS = new Set([
  'todo',
  'to-do',
  'todo:',
  'to-do:',
  '-',
  'n/a',
  'na',
  'none',
  'null',
  'keine angabe',
  'keine angaben',
  'nicht angegeben',
  'nicht genannt',
  'nicht vorhanden',
  'offen',
]);

export function isPlaceholderString(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (KNOWN_PLACEHOLDERS.has(normalized)) return true;
  return /^[a-zA-ZäöüÄÖÜß\s_-]{2,60}:\s*$/.test(value.trim());
}

export function hasMeaningfulContent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return !isPlaceholderString(value);
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

export function sanitizeStructuredValue(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (isPlaceholderString(trimmed)) return null;
    return trimmed;
  }

  if (Array.isArray(value)) {
    const cleaned = value
      .map((item) => sanitizeStructuredValue(item))
      .filter((item) => hasMeaningfulContent(item));
    return cleaned.length > 0 ? cleaned : null;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, nested]) => [key, sanitizeStructuredValue(nested)])
      .filter(([, nested]) => hasMeaningfulContent(nested));
    return entries.length > 0 ? Object.fromEntries(entries) : null;
  }

  return value;
}
