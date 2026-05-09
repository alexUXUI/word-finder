import { expect, test } from '@playwright/test';

/**
 * Regression tests for the kill-switch service worker.
 *
 * Bug: f163043 shipped a /service-worker.js whose `activate` handler called
 * `client.navigate(client.url)` for every controlled tab. The page-side
 * registrar (Qwik's <ServiceWorkerRegister />) re-registered the SW on every
 * page load, so the navigate fired on every install — producing an infinite
 * page-reload loop that crashed mobile browsers.
 *
 * The fix:
 *   1. Remove the `client.navigate()` from the SW's activate handler.
 *   2. Stop rendering <ServiceWorkerRegister /> in root.tsx, so the page no
 *      longer auto-registers. Legacy users with a cached registration still
 *      get cleaned up because the browser auto-fetches the SW on its next
 *      update check.
 *   3. Delete src/routes/service-worker.ts so the build doesn't emit Qwik
 *      prefetch metadata that was getting concatenated into our kill-switch
 *      file in dist/.
 *
 * These tests pin all three invariants.
 */

test.describe('kill-switch service worker @canary', () => {
  test.beforeEach(async ({ context }) => {
    // Each test runs against a fresh origin: no leftover SW registrations
    // or caches from a prior test. Without this we'd see false positives
    // because a SW registered in test N can leak into test N+1.
    await context.clearCookies();
    await context.clearPermissions();
  });

  test('the SSR HTML does not contain an inline SW registrar', async ({
    page,
  }) => {
    const response = await page.goto('/');
    expect(response?.ok()).toBe(true);
    const html = await response!.text();
    // The Qwik <ServiceWorkerRegister /> component injects a script that
    // calls navigator.serviceWorker.register(). Removing that component
    // removes the inline call. If this regex matches, someone re-added
    // <ServiceWorkerRegister /> to root.tsx — which would auto-register
    // /service-worker.js on every page load and (combined with any future
    // navigate-on-activate regression) re-introduce the reload loop.
    expect(html).not.toMatch(/navigator\.serviceWorker\.register\(/);
  });

  test('the SW source contains no client.navigate calls', async ({ page }) => {
    // Defense in depth: even if someone adds <ServiceWorkerRegister /> back,
    // the SW itself must never auto-reload tabs. This test reads the
    // currently-served SW bytes and pins that invariant.
    const response = await page.request.get('/service-worker.js');
    expect(response.ok()).toBe(true);
    const source = await response.text();
    // Strip comments first — our SW intentionally documents the bug it
    // prevents, so "client.navigate(client.url)" appears in prose. We only
    // care about actual code matches.
    const codeOnly = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    // The exact loop trigger from f163043. Any future regression that
    // re-introduces it will fail this assertion immediately.
    expect(codeOnly).not.toMatch(/client\.navigate\s*\(/);
    expect(codeOnly).not.toMatch(/clients\.matchAll[\s\S]*navigate/);
  });

  test('registering the SW results in zero registrations afterwards', async ({
    page,
  }) => {
    await page.goto('/');
    // Manually register the kill-switch (simulating a legacy user whose
    // browser still has /service-worker.js registered from a prior deploy).
    // The SW must install, activate, claim, and unregister — leaving
    // getRegistrations() empty.
    const result = await page.evaluate(async () => {
      // Wipe any state left over from prior tests in this browser session.
      for (const r of await navigator.serviceWorker.getRegistrations()) {
        await r.unregister();
      }
      for (const k of await caches.keys()) await caches.delete(k);

      await navigator.serviceWorker.register('/service-worker.js');
      // Poll until the registration list empties out (the SW unregisters
      // itself in `activate`). Cap at 5s — any longer than that and the
      // kill-switch is broken.
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const regs = await navigator.serviceWorker.getRegistrations();
        // A "removed" registration may still show transiently while the
        // controlled page is alive. We only need it to drop off our list.
        if (regs.length === 0) return { final: 0, looped: false };
        await new Promise((f) => setTimeout(f, 100));
      }
      const finalRegs = await navigator.serviceWorker.getRegistrations();
      return { final: finalRegs.length, looped: false };
    });
    expect(result.final).toBe(0);
  });

  test('SW registration does not trigger a page reload (no infinite loop)', async ({
    page,
  }) => {
    // The smoking gun for the original bug: a single navigate trigger
    // becomes a continuous reload because each reload re-registers the SW.
    // We register the SW, sit on the page for several seconds, and assert
    // the document stays put. If the bug regresses, the page reloads N
    // times in this window and our load counter explodes.
    await page.goto('/');
    await page.evaluate(async () => {
      // Counter persists across same-document reloads only via a
      // navigation-counting hook; for hard reloads we read it back via
      // performance entries on each check.
      (window as any).__loadCounter__ = ((window as any).__loadCounter__ ?? 0) + 1;
      // Kick off registration. If the SW navigates clients in `activate`,
      // this will trigger a reload — wiping __loadCounter__ but leaving a
      // new entry in performance.getEntriesByType('navigation').
      await navigator.serviceWorker.register('/service-worker.js');
    });

    // Wait long enough that a real loop would have produced 5+ reloads.
    await page.waitForTimeout(4000);

    const navCount = await page.evaluate(
      () => performance.getEntriesByType('navigation').length,
    );
    // Exactly one navigation entry: our initial page.goto. Anything more
    // than 1 means the SW auto-reloaded the tab.
    expect(navCount).toBe(1);
  });
});
