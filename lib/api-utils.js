import { logError } from './observability';
import { applyRateLimitHeaders, checkRateLimit } from './rate-limit';
import { safeFetch } from './network-guard';

export function logApiError(scope, error, context = {}) {
  logError('api.error', error, { scope, ...context });
}

export function serverError(res, message = 'Interner Serverfehler') {
  return res.status(500).json({ message });
}

export async function enforceRateLimit(req, res, options = {}, message = 'Zu viele Anfragen. Bitte später erneut versuchen.') {
  const rate = await checkRateLimit(req, options);
  applyRateLimitHeaders(res, rate);
  if (!rate.allowed) {
    res.status(429).json({ message });
    return false;
  }
  return true;
}

function resolveHttpTimeoutMs(explicitTimeoutMs = null) {
  if (Number.isFinite(Number(explicitTimeoutMs)) && Number(explicitTimeoutMs) > 0) {
    return Number(explicitTimeoutMs);
  }
  const envTimeout = Number.parseInt(process.env.HTTP_CLIENT_TIMEOUT_MS, 10);
  if (Number.isFinite(envTimeout) && envTimeout > 0) {
    return envTimeout;
  }
  return 30_000;
}

// Routes through lib/network-guard.js safeFetch so SSRF / metadata-host /
// private-IP rebinding checks apply uniformly to every outbound HTTP call
// from the webapp (M10 of cybersecurity-audit-2026-05-09).
export async function fetchWithTimeout(url, options = {}, timeoutMs = null) {
  const resolvedTimeoutMs = resolveHttpTimeoutMs(timeoutMs);
  return safeFetch(url, options, { timeoutMs: resolvedTimeoutMs });
}
