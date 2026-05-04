// Self-unregistering service worker.
//
// The HTML's inline registrar always tries to install /service-worker.js.
// A previous deploy installed a Qwik service-worker that cached chunk
// hashes; subsequent builds produce different hashes, so the cached SW
// keeps serving 404'd chunks and the page hard-fails (board doesn't
// hydrate, dynamic imports throw).
//
// This shim takes over registration, unregisters itself, purges every
// cache it owns, and tells the controlling client to reload. After one
// visit the browser is clean — and stays clean as long as this file
// keeps shipping (a 404 here re-introduces the bug if any deploy ever
// installed a real SW).
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      // Take control of any pages already open.
      await self.clients.claim();
      const reg = await self.registration;
      try { await reg.unregister(); } catch { /* noop */ }
      // Force-reload every controlled page so they fetch fresh chunks
      // through the network, not through this dying SW.
      const all = await self.clients.matchAll({ type: 'window' });
      for (const client of all) {
        try { client.navigate(client.url); } catch { /* noop */ }
      }
    })(),
  );
});

// Pass-through fetch — never cache anything from this SW.
self.addEventListener('fetch', () => {
  /* let the network handle it */
});
