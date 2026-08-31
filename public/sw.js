/* global GhostTyperServiceWorkerPolicy */
importScripts('/sw-policy.js');

const CACHE_NAME = 'ghosttyper-shell-v1';
const CACHE_PREFIX = 'ghosttyper-shell-';
const { STATIC_SHELL_PATHS, isApiRequest, shouldCacheStaticRequest } = GhostTyperServiceWorkerPolicy;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_SHELL_PATHS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const origin = self.location.origin;

  // Authenticated/API traffic must never be cached. Let the browser perform a
  // normal network request so private responses cannot leak through the SW.
  if (isApiRequest(request.url, origin)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/offline.html')),
    );
    return;
  }

  if (!shouldCacheStaticRequest({
    requestUrl: request.url,
    method: request.method,
    origin,
  })) return;

  const update = caches.open(CACHE_NAME).then((cache) => fetch(request).then(async (response) => {
    if (response.ok) await cache.put(request, response.clone());
    return response;
  }));
  // Register background work synchronously while the FetchEvent is active.
  event.waitUntil(update.catch(() => undefined));
  event.respondWith(caches.match(request).then((cached) => cached || update));
});
