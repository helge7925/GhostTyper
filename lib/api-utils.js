export function logApiError(scope, error) {
  const message = error?.message || 'Unknown error';
  console.error(`${scope}: ${message}`);
}

export function serverError(res, message = 'Interner Serverfehler') {
  return res.status(500).json({ message });
}

