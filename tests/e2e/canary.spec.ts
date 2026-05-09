import { test, expect } from '@playwright/test';

/**
 * Canary smoke tests — fast, deterministic, run on every CF Pages
 * preview deployment in `.github/workflows/canary.yml`.
 *
 * The bar for "should this be a canary?":
 *   - Catches a class of bug that would block a real user from using
 *     the app (blank page, infinite loop, JS exception on load).
 *   - Runs in <10s per browser without external network dependencies
 *     beyond the deployment under test.
 *   - Deterministic — no flakes from timing, animations, or worker
 *     warm-up.
 *
 * Stuff that does NOT belong here: anything that needs the dictionary
 * worker to finish (slow), visual regression (flaky), or multi-step
 * interaction (slow + flaky). Those live in the broader e2e suite and
 * run on developer machines / pre-merge.
 *
 * Tagged @canary so the canary workflow selects it via `--grep`.
 */

test.describe('production smoke @canary', () => {
  test('homepage returns 200 and ships a board', async ({ page }) => {
    // The smoke fix-point: a deploy that doesn't render the board at all
    // (because chunks 404, hydration errors, SW interferes, etc.) is
    // strictly worse than no deploy. We assert the most basic possible
    // shape of "something useful was served".
    const response = await page.goto('/');
    expect(response?.status(), 'homepage HTTP status').toBe(200);
    await expect(
      page.getByTestId('app-title'),
      'header title rendered',
    ).toHaveText('Word Finder');
    await expect(
      page.locator('[data-testid^="cell-"]').first(),
      'at least one board cell present',
    ).toBeVisible({ timeout: 10_000 });
  });

  test('homepage emits no fatal console errors during initial load', async ({
    page,
  }) => {
    // We collect EVERY console error during the first ~3 seconds of
    // page life. Any error counts as a regression — including the
    // "Failed to fetch dynamically imported module" that the original
    // stale-chunk bug produced. Allowed exceptions: backend 4xx/5xx
    // from /api/ endpoints (often environmental — e.g. profile DO not
    // bound on a preview deploy) since those don't break the player UI.
    const errors: string[] = [];
    // The multiplayer/profile DO is bound to a separate Worker
    // (`word-finder-multiplayer`) and may legitimately be down on a
    // preview env, returning 4xx/5xx or refusing the connection. The
    // player UI handles those responses gracefully — they don't break
    // the page. Filter them out so the canary stays focused on
    // bundle-load / hydration failures.
    const isInfrastructureNoise = (url: string) =>
      /\/api\/profile\//.test(url) ||
      /\/api\/games\//.test(url) ||
      /:8788\//.test(url);

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const url = msg.location().url;
      if (url && isInfrastructureNoise(url)) return;
      const text = msg.text();
      if (isInfrastructureNoise(text)) return;
      errors.push(`${text}${url ? ` @ ${url}` : ''}`);
    });
    page.on('requestfailed', (req) => {
      const url = req.url();
      if (isInfrastructureNoise(url)) return;
      // Bundle/chunk fetch failures are exactly the class the original
      // SW bug produced — those MUST fail the canary.
      errors.push(`requestfailed: ${url} (${req.failure()?.errorText})`);
    });
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    expect(errors, `console errors during load:\n${errors.join('\n')}`).toEqual(
      [],
    );
  });
});
