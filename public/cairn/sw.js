/*
 * TOMBSTONE.
 *
 * An earlier build of CAIRN shipped a service worker that served navigations
 * cache-first. That is the standard way to strand a device on a dead deploy:
 * the cached index.html points at content-hashed assets from the old build, and
 * no amount of reloading gets the user a newer page, because the old worker
 * answers every navigation from its own cache before the network is consulted.
 *
 * It stranded a real phone on the one build where the title card swallowed
 * every touch — so the game could neither be started nor updated. That is the
 * worst possible pair of bugs to ship together.
 *
 * This file is no longer a cache. It exists only to remove its predecessor:
 * take control immediately, delete every cache, unregister itself, and reload
 * whatever it was controlling so the page comes back from the network.
 *
 * Offline play is a feature. Being unable to update is not a trade worth making
 * for it. A service worker returns to this game only behind a deploy pipeline
 * that can prove it cannot strand anyone.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch { /* nothing cached, nothing to clear */ }
    try { await self.registration.unregister(); } catch { /* already gone */ }
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) {
      try { c.navigate(c.url); } catch { /* the page script also self-heals */ }
    }
  })());
});

// Never intercept anything. Every request goes straight to the network.
