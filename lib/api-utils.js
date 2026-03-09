import { logError } from './observability';
import { applyRateLimitHeaders, checkRateLimit } from './rate-limit';

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

export async function fetchWithTimeout(url, options = {}, timeoutMs = null) {
  const resolvedTimeoutMs = resolveHttpTimeoutMs(timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), resolvedTimeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`HTTP_TIMEOUT:${resolvedTimeoutMs}`);
      timeoutError.code = 'HTTP_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
