// Self-unregistering service worker (idempotent kill-switch).
//
// History: a previous deploy installed Qwik's prefetch service-worker
// (`@builder.io/qwik-city/service-worker` + setupServiceWorker()) which
// cached chunk hashes. Subsequent builds emit different hashes, so the
// cached SW kept serving 404'd q-*.js chunks, hard-failing the page.
//
// This shim's only job is to clean up users who have ANY SW registered
// against this origin: take over the registration, purge every cache it
// owns, then unregister itself so the next page load fetches everything
// straight from the network.
//
// CRITICAL invariant: the activate handler MUST NOT call
// `client.navigate(client.url)`. The page-side registrar (Qwik's
// <ServiceWorkerRegister /> or any other registrar) calls register()
// on every page load. If we navigate clients in activate, the resulting
// reload re-runs the registrar, re-registers /service-worker.js,
// triggers a new install/activate, and we navigate again — an infinite
// reload loop that crashes mobile browsers. This was f163043's bug.
//
// Without the navigate, the worst case for legacy users with truly
// broken cached chunks is one manual refresh. Acceptable.

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(purgeAllCaches());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await purgeAllCaches();
      await self.clients.claim();
      try {
        await self.registration.unregister();
      } catch {
        /* noop */
      }
    })(),
  );
});

self.addEventListener('fetch', () => {
  /* pass-through; let the network handle it */
});

async function purgeAllCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
}
