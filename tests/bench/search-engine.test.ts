/**
 * Phase 1.5 bench: single-shot generator vs best-of-N search.
 *
 * Demonstrates that the search engine recovers (and exceeds) the word-count
 * we sacrificed in Phase 1.2 by picking the best of N diverse candidates.
 *
 * Run via `yarn bench`. Writes a versioned baseline to docs/baselines/.
 */
import { it, vi } from 'vitest';
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

vi.mock('@builder.io/qwik', () => ({ $: <T,>(fn: T) => fn }));
vi.mock('tone', () => ({
  MonoSynth: class {
    toDestination() { return this; }
    triggerAttackRelease() {}
  },
  now: () => 0,
}));
vi.mock('../../src/components/boggle/logic/confetti', () => ({
  fireworks: () => {},
}));

import { solve } from '../../src/components/boggle/logic/boggle';
import { randomBoard } from '../../src/components/boggle/logic/board';
import { trie } from '../../src/components/boggle/logic/trie';
import { searchForBoard } from '../../src/components/boggle/generation/search';
import { Language } from '../../src/components/boggle/models';

const CACHE_PATH = 'node_modules/.cache/bench-dict-engmix.json';
const DICT_URL = 'https://boggle.pages.dev/engmix.txt';
const N_BOARDS = 50;
const SIZE = 5;
const MIN_WORD_LEN = 5;

async function loadDictionary(): Promise<string[]> {
  if (existsSync(CACHE_PATH)) {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  }
  console.log(`fetching ${DICT_URL}…`);
  const r = await fetch(DICT_URL);
  const text = await r.text();
  const dict = text
    .replace(/(\r\n|\n|\r)/gm, ' ')
    .split(' ')
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(dict));
  return dict;
}

interface Stats {
  min: number;
  max: number;
  mean: number;
  median: number;
  p10: number;
  p90: number;
  stdDev: number;
}
const stats = (arr: number[]): Stats => {
  const sorted = [...arr].sort((a, b) => a - b);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    median: sorted[Math.floor(sorted.length / 2)],
    p10: sorted[Math.floor(sorted.length * 0.1)],
    p90: sorted[Math.floor(sorted.length * 0.9)],
    stdDev: Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length),
  };
};

it('single-shot vs best-of-N search', async () => {
  const dict = await loadDictionary();
  console.log(`dict size: ${dict.length}`);

  // --- Single-shot baseline ---
  const singleResults = [];
  for (let i = 0; i < N_BOARDS; i++) {
    trie.root = { children: {} };
    const board = randomBoard('English', SIZE);
    const t0 = performance.now();
    const words = solve(dict, board.split(''));
    const tMs = performance.now() - t0;
    const long = words.filter((w) => w.length >= MIN_WORD_LEN);
    singleResults.push({ board, total: words.length, longCount: long.length, tMs });
  }

  // --- Best-of-N search ---
  // Budget per board: 5s / 75 candidates. This is the Phase 1.5 budget.
  const searchResults: Array<{
    board: string;
    total: number;
    longCount: number;
    finalScore: number;
    elapsedMs: number;
    candidatesEvaluated: number;
    reason: string;
  }> = [];
  for (let i = 0; i < N_BOARDS; i++) {
    const r = searchForBoard({
      size: SIZE,
      language: Language.English,
      minWordLength: MIN_WORD_LEN,
      dictionary: dict,
      maxCandidates: 75,
      maxMs: 5_000,
    });
    searchResults.push({
      board: r.board,
      total: r.score.totalWords,
      longCount: r.score.playerRelevantWords,
      finalScore: r.score.finalScore,
      elapsedMs: r.elapsedMs,
      candidatesEvaluated: r.candidatesEvaluated,
      reason: r.reason,
    });
  }

  const singleLong = singleResults.map((r) => r.longCount);
  const singleTotal = singleResults.map((r) => r.total);
  const searchLong = searchResults.map((r) => r.longCount);
  const searchTotal = searchResults.map((r) => r.total);
  const searchElapsed = searchResults.map((r) => r.elapsedMs);
  const searchCandidates = searchResults.map((r) => r.candidatesEvaluated);

  const findings = {
    config: {
      N_BOARDS,
      SIZE,
      MIN_WORD_LEN,
      dictSize: dict.length,
      runAt: new Date().toISOString(),
      label: process.env.BENCH_LABEL ?? 'phase1.5-search-engine',
      gitSha: process.env.BENCH_GIT_SHA ?? null,
    },
    singleShot: {
      playerRelevantWords: stats(singleLong),
      totalWords: stats(singleTotal),
    },
    bestOfN: {
      playerRelevantWords: stats(searchLong),
      totalWords: stats(searchTotal),
      elapsedMsPerBoard: stats(searchElapsed),
      candidatesEvaluatedPerBoard: stats(searchCandidates),
      stopReasons: searchResults.reduce<Record<string, number>>((acc, r) => {
        acc[r.reason] = (acc[r.reason] ?? 0) + 1;
        return acc;
      }, {}),
    },
    delta: {
      meanPlayerRelevantWords:
        searchLong.reduce((a, b) => a + b, 0) / searchLong.length -
        singleLong.reduce((a, b) => a + b, 0) / singleLong.length,
      p10PlayerRelevantWords:
        stats(searchLong).p10 - stats(singleLong).p10,
      p90PlayerRelevantWords:
        stats(searchLong).p90 - stats(singleLong).p90,
    },
    sampleSearchBoards: searchResults.slice(0, 5).map((r) => ({
      board: r.board,
      totalWords: r.total,
      fivePlusWords: r.longCount,
      finalScore: r.finalScore,
      elapsedMs: r.elapsedMs,
      candidatesEvaluated: r.candidatesEvaluated,
    })),
  };

  mkdirSync('docs/baselines', { recursive: true });
  const ts = findings.config.runAt.replace(/[:.]/g, '-');
  const label = findings.config.label.replace(/[^a-z0-9-.]/gi, '-');
  const versionedPath = `docs/baselines/${ts}__${label}.json`;
  writeFileSync(versionedPath, JSON.stringify(findings, null, 2));

  console.log('---');
  console.log(`Wrote ${versionedPath}`);
  console.log(
    JSON.stringify(
      {
        single_meanFivePlus: findings.singleShot.playerRelevantWords.mean.toFixed(1),
        single_p10FivePlus: findings.singleShot.playerRelevantWords.p10,
        bestOfN_meanFivePlus: findings.bestOfN.playerRelevantWords.mean.toFixed(1),
        bestOfN_p10FivePlus: findings.bestOfN.playerRelevantWords.p10,
        bestOfN_meanElapsedMs: findings.bestOfN.elapsedMsPerBoard.mean.toFixed(0),
        bestOfN_meanCandidates: findings.bestOfN.candidatesEvaluatedPerBoard.mean.toFixed(1),
        stopReasons: findings.bestOfN.stopReasons,
        Δ_meanFivePlus: findings.delta.meanPlayerRelevantWords.toFixed(1),
        Δ_p10: findings.delta.p10PlayerRelevantWords,
        Δ_p90: findings.delta.p90PlayerRelevantWords,
      },
      null,
      2
    )
  );
});
