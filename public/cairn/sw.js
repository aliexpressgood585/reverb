/*
 * CAIRN offline. The whole game is a handful of small text files, so the
 * service worker caches everything it is asked for and serves cache-first
 * afterwards. Installed to the home screen, it launches with no network at all.
 *
 * Cache-first is safe here because the build fingerprints every asset filename;
 * a new deploy is new URLs, and the version bump below sweeps the old ones.
 */
const CACHE = 'cairn-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html']).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
