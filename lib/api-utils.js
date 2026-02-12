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
