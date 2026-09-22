/**
 * Offline shell for the image-variations PWA.
 *
 * Only the static shell is cached. API calls always go to the network:
 * a stale plan or a replayed generate would be worse than an error.
 */

const CACHE = 'image-variations-v1';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'net.js',
  'db.js',
  'i18n.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) {
    return;
  }

  // Network first so an edit to the shell shows up on the next load,
  // with the cache as the offline fallback.
  event.respondWith(
    fetch(request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(request).then(hit => hit || caches.match('index.html')))
  );
});
