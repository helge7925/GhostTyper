const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

export function isValidEmail(value) {
  const normalized = normalizeEmail(value);
  if (!normalized) return false;
  return EMAIL_REGEX.test(normalized);
}
