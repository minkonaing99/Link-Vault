const CACHE = 'linknest-v1';

// Public assets only — protected pages are cached at runtime after login
const PRECACHE = [
  '/login.html',
  '/offline.html',
  '/css/styles.css',
  '/js/shared.js',
  '/js/home.js',
  '/js/browse.js',
  '/js/editor.js',
  '/js/login.js',
  '/img/logo-mark.png',
  '/img/icon-192.png',
  '/img/apple-touch-icon.png',
  '/manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // API: network-only, return a JSON error response when offline
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({ error: 'You are offline. Please check your connection.' }),
          { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
        )
      )
    );
    return;
  }

  // Navigation: network-first, cache successful responses for offline use
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            caches.open(CACHE).then(c => c.put(request, res.clone()));
          }
          return res;
        })
        .catch(() =>
          caches.match(request).then(cached => cached || caches.match('/offline.html'))
        )
    );
    return;
  }

  // Static assets: cache-first, fetch and cache on miss
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (res.ok) {
          caches.open(CACHE).then(c => c.put(request, res.clone()));
        }
        return res;
      });
    })
  );
});
