// Service Worker for 素描临摹 3D 参考
// Strategy: cache-first for shell (HTML/CSS/JS), network-first for GLB models

const CACHE_VERSION = 'v3';
const SHELL_CACHE = 'sketch-ref-shell-' + CACHE_VERSION;
const RUNTIME_CACHE = 'sketch-ref-runtime-' + CACHE_VERSION;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  'https://unpkg.com/three@0.160.0/build/three.module.js',
  'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js',
  'https://unpkg.com/three@0.160.0/examples/jsm/environments/RoomEnvironment.js',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      console.log('[SW] Caching shell files');
      // Use addAll with no errors if some fail (e.g., fonts may need CORS)
      return Promise.allSettled(SHELL_FILES.map(url => cache.add(url).catch(e => console.warn('[SW] skip:', url, e))));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => name.startsWith('sketch-ref-') && name !== SHELL_CACHE && name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension and other non-http(s)
  if (!url.protocol.startsWith('http')) return;

  // GLB models and assets: cache-first
  if (url.pathname.endsWith('.glb') || url.pathname.endsWith('.png') || url.pathname.endsWith('.jpg')) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) => {
        return cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          }).catch(() => cached);
        });
      })
    );
    return;
  }

  // Shell files: network-first, fall back to cache
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});
