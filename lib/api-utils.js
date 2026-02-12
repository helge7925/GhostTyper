import { logError } from './observability';

export function logApiError(scope, error, context = {}) {
  logError('api.error', error, { scope, ...context });
}

export function serverError(res, message = 'Interner Serverfehler') {
  return res.status(500).json({ message });
}
