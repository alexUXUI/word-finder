/**
 * Visual capture for the multiplayer panel — produces three snapshots
 * (lobby, playing, ended) so a human can spot-check the design without
 * running two tabs by hand. Saves into the project root.
 *
 * NOT a regression test — uses page.screenshot, not toHaveScreenshot.
 */
import { test } from '@playwright/test';
import path from 'node:path';

const GAME = `vis-${Date.now()}`;

test('capture multiplayer panel states', async ({ browser }, testInfo) => {
  testInfo.setTimeout(60_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const dir = path.resolve(__dirname, '../../');

  await Promise.all([a.goto('/'), b.goto('/')]);

  // disconnected — JoinForm
  await a.getByTestId('multiplayer-toggle').click();
  await a.screenshot({ path: path.join(dir, 'mp-disconnected.png'), fullPage: false });

  // join both → lobby
  await a.getByTestId('mp-game-name-input').fill(GAME);
  await a.getByTestId('mp-display-name-input').fill('Alice');
  await a.getByTestId('mp-join').click();

  await b.getByTestId('multiplayer-toggle').click();
  await b.getByTestId('mp-game-name-input').fill(GAME);
  await b.getByTestId('mp-display-name-input').fill('Bob');
  await b.getByTestId('mp-join').click();

  await a.locator('[data-testid="multiplayer-panel"][data-state="lobby"]').waitFor({ timeout: 10_000 });
  await a.screenshot({ path: path.join(dir, 'mp-lobby.png'), fullPage: false });

  // start → playing
  await a.getByTestId('mp-start').click();
  await a.locator('[data-testid="multiplayer-panel"][data-state="playing"]').waitFor({ timeout: 5_000 });
  await b.locator('[data-testid="multiplayer-panel"][data-state="playing"]').waitFor({ timeout: 5_000 });
  // Give the panel a beat to render the new state fully.
  await a.waitForTimeout(300);
  await a.screenshot({ path: path.join(dir, 'mp-playing.png'), fullPage: false });

  // both ready → ended
  await a.getByTestId('mp-ready-toggle').click();
  await b.getByTestId('mp-ready-toggle').click();
  await a.locator('[data-testid="multiplayer-panel"][data-state="ended"]').waitFor({ timeout: 5_000 });
  await a.waitForTimeout(300);
  await a.screenshot({ path: path.join(dir, 'mp-ended.png'), fullPage: false });

  await ctxA.close();
  await ctxB.close();
});
