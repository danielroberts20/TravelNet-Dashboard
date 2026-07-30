// Minimal service worker: on navigation, if the network fails (Pi/Flask
// backend unreachable), serve a static offline page with a link to Watchdog.
// Does NOT cache the SPA shell, /api/* calls, or EventSource streams —
// only ever intercepts top-level navigations.

const CACHE_NAME = 'watchdog-fallback-v1';
const FALLBACK_URL = '/static/fallback.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(FALLBACK_URL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// nginx (or whatever's in front) can hang for tens of seconds before even
// answering with an error, and a 5xx response RESOLVES fetch() rather than
// rejecting it — so both a timeout and an explicit status check are needed.
const NAV_TIMEOUT_MS = 3500;

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;

  const url = event.request.url;

  // Cross-origin navigations (e.g. the Watchdog link on fallback.html) must
  // be left completely alone — respondWith()-ing them means this SW itself
  // fetches the foreign origin and stands in for the browser's own
  // navigation, which is what caused the "loads then bounces back" bug.
  if (new URL(url).origin !== self.location.origin) {
    console.log(`[sw] navigate: cross-origin ${url}, ignoring (no respondWith)`);
    return;
  }

  const t0 = performance.now();
  console.log(`[sw] navigate: attempting network fetch for ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NAV_TIMEOUT_MS);

  event.respondWith(
    fetch(event.request, { signal: controller.signal })
      .then((res) => {
        clearTimeout(timeoutId);
        if (!res.ok) {
          console.log(`[sw] navigate: network responded but not ok for ${url} (status ${res.status}) after ${(performance.now() - t0).toFixed(0)}ms`);
          console.log(`[sw] navigate: serving cached fallback for ${url}`);
          return caches.match(FALLBACK_URL);
        }
        console.log(`[sw] navigate: network succeeded for ${url} (status ${res.status}) after ${(performance.now() - t0).toFixed(0)}ms`);
        return res;
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        const reason = err && err.name === 'AbortError' ? `timed out after ${NAV_TIMEOUT_MS}ms` : String(err);
        console.log(`[sw] navigate: network threw for ${url} after ${(performance.now() - t0).toFixed(0)}ms — ${reason}`);
        console.log(`[sw] navigate: serving cached fallback for ${url}`);
        return caches.match(FALLBACK_URL);
      })
  );
});
