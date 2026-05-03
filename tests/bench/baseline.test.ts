/**
 * Phase 0 baseline benchmark.
 *
 * Measures the current `solve()` and `randomBoard()` against the production
 * English dictionary, plus a diversity baseline (pairwise Jaccard on player-
 * relevant word sets, pairwise Levenshtein on the flat 25-char board).
 *
 * Outputs:
 *   - docs/.benchmark-baseline.json (structured numbers)
 *   - console summary
 *
 * Run via `yarn bench`.
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

const CACHE_PATH = 'node_modules/.cache/bench-dict-engmix.json';
const DICT_URL = 'https://boggle.pages.dev/engmix.txt';
const N_BOARDS = 100;
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
  const variance =
    arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    median: sorted[Math.floor(sorted.length / 2)],
    p10: sorted[Math.floor(sorted.length * 0.1)],
    p90: sorted[Math.floor(sorted.length * 0.9)],
    stdDev: Math.sqrt(variance),
  };
};

const levenshtein = (a: string, b: string): number => {
  const dp: number[][] = Array.from(
    { length: a.length + 1 },
    () => new Array(b.length + 1).fill(0)
  );
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
};

it('baseline: current generator + solver + diversity', async () => {
  const dict = await loadDictionary();
  console.log(`dictionary size: ${dict.length}`);

  // Generate boards.
  const tGen0 = performance.now();
  const boards = Array.from({ length: N_BOARDS }, () =>
    randomBoard('English', SIZE)
  );
  const generationTotalMs = performance.now() - tGen0;

  // Solve each. Reset the trie between calls so the singleton bleed doesn't
  // contaminate timing — even though identical dict re-additions are
  // idempotent, we want clean numbers.
  const results = boards.map((boardStr) => {
    trie.root = { children: {} };
    const tSolve0 = performance.now();
    const words = solve(dict, boardStr.split(''));
    const tSolveMs = performance.now() - tSolve0;
    const longWords = words.filter((w) => w.length >= MIN_WORD_LEN);
    return {
      board: boardStr,
      words,
      longWords,
      total: words.length,
      longCount: longWords.length,
      tSolveMs,
    };
  });

  // Diversity: pairwise Jaccard on the 5+ letter word set.
  const jaccards: number[] = [];
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const a = new Set(results[i].longWords);
      const b = new Set(results[j].longWords);
      const inter = new Set([...a].filter((x) => b.has(x)));
      const union = new Set([...a, ...b]);
      jaccards.push(union.size === 0 ? 0 : inter.size / union.size);
    }
  }

  // Diversity: pairwise Levenshtein on the flat board string.
  const levs: number[] = [];
  for (let i = 0; i < boards.length; i++) {
    for (let j = i + 1; j < boards.length; j++) {
      levs.push(levenshtein(boards[i], boards[j]));
    }
  }

  // Structural metrics — these are the ones Phase 1's vowel-pool fix moves.
  const VOWEL_RE = /[aeiou]/i;
  const vowelMultisetSignature = (s: string) =>
    [...s.toLowerCase()].filter((c) => VOWEL_RE.test(c)).sort().join('');
  const vowelMultisets = boards.map(vowelMultisetSignature);
  const distinctVowelMultisets = new Set(vowelMultisets);
  const vowelMultisetEntropy = (() => {
    const counts = new Map<string, number>();
    for (const v of vowelMultisets) counts.set(v, (counts.get(v) ?? 0) + 1);
    const total = vowelMultisets.length;
    let h = 0;
    for (const c of counts.values()) {
      const p = c / total;
      h -= p * Math.log2(p);
    }
    return h;
  })();

  const vowelCounts = boards.map(
    (s) => [...s.toLowerCase()].filter((c) => VOWEL_RE.test(c)).length
  );

  // Per-letter frequency across all cells.
  const letterCounts = new Map<string, number>();
  let totalCells = 0;
  for (const b of boards) {
    for (const c of b.toLowerCase()) {
      if (/[a-z]/.test(c)) {
        letterCounts.set(c, (letterCounts.get(c) ?? 0) + 1);
        totalCells++;
      }
    }
  }
  const letterFrequencies = Object.fromEntries(
    Array.from(letterCounts.entries())
      .map(([k, v]) => [k, v / totalCells])
      .sort((a, b) => (a[0] as string).localeCompare(b[0] as string))
  );
  const letterCoverage = letterCounts.size; // distinct letters seen across N boards
  const lettersNeverSeen = 'abcdefghijklmnopqrstuvwxyz'
    .split('')
    .filter((l) => !letterCounts.has(l));

  // Bigram coverage on the 8-neighbor board graph, across all boards.
  const seenBigrams = new Set<string>();
  for (const b of boards) {
    for (let i = 0; i < SIZE; i++) {
      for (let j = 0; j < SIZE; j++) {
        const a = b[i * SIZE + j].toLowerCase();
        for (const [di, dj] of [
          [-1, -1], [-1, 0], [-1, 1],
          [0, -1],           [0, 1],
          [1, -1],  [1, 0],  [1, 1],
        ]) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= SIZE || nj >= SIZE) continue;
          const c = b[ni * SIZE + nj].toLowerCase();
          // Order-independent for this bigram metric (path direction doesn't matter).
          seenBigrams.add(a < c ? a + c : c + a);
        }
      }
    }
  }
  // 26 letters → 26 same-letter bigrams + C(26,2)=325 distinct-letter bigrams = 351 possible.
  const bigramCoverage = seenBigrams.size;

  const totalCounts = results.map((r) => r.total);
  const longCounts = results.map((r) => r.longCount);
  const solveTimes = results.map((r) => r.tSolveMs);
  const meanSolveMs =
    solveTimes.reduce((a, b) => a + b, 0) / solveTimes.length;

  const findings = {
    config: {
      N_BOARDS,
      SIZE,
      MIN_WORD_LEN,
      dictUrl: DICT_URL,
      dictSize: dict.length,
      runAt: new Date().toISOString(),
      label: process.env.BENCH_LABEL ?? 'current-generator',
      gitSha: process.env.BENCH_GIT_SHA ?? null,
    },
    timing: {
      generationTotalMs,
      generationPerBoardMs: generationTotalMs / N_BOARDS,
      solve: stats(solveTimes),
      candidatesPerSecond: 1000 / meanSolveMs,
    },
    wordCount: {
      total: stats(totalCounts),
      playerRelevant_5plus: stats(longCounts),
    },
    diversity: {
      jaccardOnPlayerRelevantWordSets: stats(jaccards),
      levenshteinOnFlatBoard: stats(levs),
      jaccardSamples: jaccards.length,
      levSamples: levs.length,
    },
    structural: {
      // Phase 1's vowel-pool fix moves these. Today they expose the bug:
      // 1 distinct vowel multiset means every board has the same vowels.
      distinctVowelMultisets: distinctVowelMultisets.size,
      vowelMultisetEntropyBits: vowelMultisetEntropy,
      vowelCount: stats(vowelCounts),
      letterCoverage,
      lettersNeverSeen,
      letterFrequencies,
      bigramCoverage,
      bigramCoverageMaxPossible: 351,
    },
    sampleBoards: results.slice(0, 5).map((r) => ({
      board: r.board,
      totalWords: r.total,
      fivePlusWords: r.longCount,
      sampleLongWords: r.longWords.slice(0, 12),
    })),
  };

  // Versioned baselines — every run drops a timestamped artifact next to a
  // pointer at the latest. Phase 1+ acceptance compares against these.
  mkdirSync('docs/baselines', { recursive: true });
  const ts = findings.config.runAt.replace(/[:.]/g, '-');
  const label = findings.config.label.replace(/[^a-z0-9-]/gi, '-');
  const versionedPath = `docs/baselines/${ts}__${label}.json`;
  writeFileSync(versionedPath, JSON.stringify(findings, null, 2));
  writeFileSync('docs/.benchmark-baseline.json', JSON.stringify(findings, null, 2));

  console.log('---');
  console.log(`Wrote ${versionedPath}`);
  console.log('Wrote docs/.benchmark-baseline.json (latest pointer)');
  console.log('Summary:');
  console.log(
    JSON.stringify(
      {
        label: findings.config.label,
        candidatesPerSecond: findings.timing.candidatesPerSecond.toFixed(2),
        meanSolveMs: findings.timing.solve.mean.toFixed(1),
        avgTotalWords: findings.wordCount.total.mean.toFixed(1),
        avgFivePlusWords:
          findings.wordCount.playerRelevant_5plus.mean.toFixed(1),
        meanJaccard:
          findings.diversity.jaccardOnPlayerRelevantWordSets.mean.toFixed(3),
        meanLevenshtein:
          findings.diversity.levenshteinOnFlatBoard.mean.toFixed(2),
        distinctVowelMultisets: findings.structural.distinctVowelMultisets,
        vowelEntropyBits: findings.structural.vowelMultisetEntropyBits.toFixed(3),
        vowelCountMean: findings.structural.vowelCount.mean.toFixed(2),
        vowelCountStdDev: findings.structural.vowelCount.stdDev.toFixed(3),
        letterCoverage: `${findings.structural.letterCoverage}/26`,
        lettersNeverSeen: findings.structural.lettersNeverSeen.join(',') || '(none)',
        bigramCoverage: `${findings.structural.bigramCoverage}/${findings.structural.bigramCoverageMaxPossible}`,
      },
      null,
      2
    )
  );
});
