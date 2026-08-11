/* Attendance Tracker — service worker (PWA offline shell).
 *
 * MUST live at the site root so its scope is "/" and it can control every page.
 * Strategy: network-first for same-origin GETs (so attendance data is always
 * fresh), falling back to the cache when offline. API calls (/api) and every
 * cross-origin request (Google sign-in, Stripe, Google Fonts, YouTube) are never
 * intercepted — the SW stays out of auth and data paths entirely.
 */
const CACHE = 'att-shell-v2';

// App shell to pre-cache for offline. A single missing asset must not fail the
// whole install, so we add them individually via allSettled.
const SHELL = [
  '/history.html', '/team.html', '/share.html', '/setup.html', '/index.html',
  '/js/utils.js', '/js/api.js', '/js/history.js', '/js/team.js', '/js/share.js',
  '/icons/icon-192.png', '/icons/icon-512.png', '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Same-origin only; never the API, never cross-origin.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api')) return;

  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      // Cache successful same-origin responses for offline fallback.
      if (res && res.ok && res.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      // Offline navigation with no exact match → serve the dashboard shell.
      if (req.mode === 'navigate') {
        const shell = await caches.match('/history.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
