/**
 * Two-context end-to-end test for the multiplayer feature.
 *
 * Drives two browser contexts (≈ two browser windows / tabs) through
 * the full happy path: join the same game, see each other in the lobby,
 * one player starts, both submit `ready`, the panel reaches the `ended`
 * state with a winner shown.
 *
 * Pre-reqs (run before this spec):
 *   - The Qwik app on :5173 (e.g. `wrangler pages dev ./dist --port 5173`)
 *   - The multiplayer Worker on :8788 (`wrangler dev --port 8788` in
 *     `multiplayer-worker/`).
 *
 * The client-side code auto-detects localhost and points the WS at
 * ws://localhost:8788/games/<name>; no env var needed.
 */
import { test, expect } from '@playwright/test';

const GAME = `e2e-${Date.now()}`;

test.describe('multiplayer — happy path', () => {
  test('two tabs join the same game, ready up, see results', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();

    // Surface client errors loudly — flaky multiplayer code is invisible
    // otherwise.
    for (const [label, page] of [['A', a], ['B', b]] as const) {
      page.on('pageerror', (err) => console.error(`[${label}] pageerror:`, err.message));
      page.on('console', (msg) => {
        if (msg.type() === 'error') console.error(`[${label}] console.error:`, msg.text());
      });
    }

    await Promise.all([a.goto('/'), b.goto('/')]);

    // Open both panels.
    await a.getByTestId('multiplayer-toggle').click();
    await b.getByTestId('multiplayer-toggle').click();

    // Fill join forms.
    await a.getByTestId('mp-game-name-input').fill(GAME);
    await a.getByTestId('mp-display-name-input').fill('Alice');
    await a.getByTestId('mp-join').click();

    await b.getByTestId('mp-game-name-input').fill(GAME);
    await b.getByTestId('mp-display-name-input').fill('Bob');
    await b.getByTestId('mp-join').click();

    // Each player should see the panel reach 'lobby' state.
    await expect(a.getByTestId('multiplayer-panel')).toHaveAttribute('data-state', 'lobby', { timeout: 15_000 });
    await expect(b.getByTestId('multiplayer-panel')).toHaveAttribute('data-state', 'lobby', { timeout: 15_000 });

    // Each lobby should list two player rows.
    await expect(a.getByTestId('mp-player-row')).toHaveCount(2, { timeout: 5_000 });
    await expect(b.getByTestId('mp-player-row')).toHaveCount(2, { timeout: 5_000 });

    // A starts the game; both panels transition to 'playing'.
    await a.getByTestId('mp-start').click();
    await expect(a.getByTestId('multiplayer-panel')).toHaveAttribute('data-state', 'playing', { timeout: 5_000 });
    await expect(b.getByTestId('multiplayer-panel')).toHaveAttribute('data-state', 'playing', { timeout: 5_000 });

    // Both ready up → game ends.
    await a.getByTestId('mp-ready-toggle').click();
    await b.getByTestId('mp-ready-toggle').click();

    await expect(a.getByTestId('multiplayer-panel')).toHaveAttribute('data-state', 'ended', { timeout: 5_000 });
    await expect(b.getByTestId('multiplayer-panel')).toHaveAttribute('data-state', 'ended', { timeout: 5_000 });

    // Both should see a leaderboard with two rows.
    await expect(a.getByTestId('mp-results-row')).toHaveCount(2);
    await expect(b.getByTestId('mp-results-row')).toHaveCount(2);

    await ctxA.close();
    await ctxB.close();
  });
});
