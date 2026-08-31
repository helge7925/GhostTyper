(function exposeServiceWorkerPolicy(root) {
  const STATIC_SHELL_PATHS = Object.freeze([
    '/offline.html',
    '/manifest.json',
    '/favicon.ico',
    '/logo.png',
    '/icon-192.png',
    '/icon-512.png',
  ]);
  const STATIC_RUNTIME_PREFIXES = Object.freeze(['/_next/static/']);

  function requestPath(requestUrl, origin) {
    try {
      return new URL(requestUrl, origin).pathname;
    } catch {
      return '';
    }
  }

  function isApiRequest(requestUrl, origin) {
    const path = requestPath(requestUrl, origin);
    return path === '/api' || path.startsWith('/api/');
  }

  function shouldCacheStaticRequest({ requestUrl, method = 'GET', origin }) {
    if (String(method).toUpperCase() !== 'GET') return false;
    try {
      const url = new URL(requestUrl, origin);
      if (url.origin !== origin || isApiRequest(url.href, origin)) return false;
      return STATIC_SHELL_PATHS.includes(url.pathname)
        || STATIC_RUNTIME_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
    } catch {
      return false;
    }
  }

  const policy = {
    STATIC_SHELL_PATHS,
    STATIC_RUNTIME_PREFIXES,
    isApiRequest,
    shouldCacheStaticRequest,
  };
  root.GhostTyperServiceWorkerPolicy = policy;
  if (typeof module !== 'undefined' && module.exports) module.exports = policy;
}(typeof self !== 'undefined' ? self : globalThis));
