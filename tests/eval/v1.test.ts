/**
 * Eval suite v1. Runs each goal in EVAL_SUITE.md against the production
 * search engine, asserts thresholds, writes a baseline artifact.
 *
 * Run via `yarn eval`. Failing thresholds exit non-zero (vitest reports the
 * failed test) — CI uses this as a merge gate for generation-affecting PRs.
 */
import { it, expect, vi } from 'vitest';
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

import { searchForBoard } from '../../src/components/boggle/generation/search';
import { buildTrie } from '../../src/components/boggle/logic/trie';
import { Language } from '../../src/components/boggle/models';
import type { ScoreWeights } from '../../src/components/boggle/generation/scorer';
import { MLflowTracer } from '../../src/components/boggle/generation/trace';
import type { Tracer } from '../../src/components/boggle/generation/trace';

const CACHE_PATH = 'node_modules/.cache/bench-dict-engmix.json';
const DICT_URL = 'https://boggle.pages.dev/engmix.txt';

async function loadDictionary(): Promise<string[]> {
  if (existsSync(CACHE_PATH)) {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  }
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

interface GoalConfig {
  id: string;
  description: string;
  weight: number;
  config: {
    size: number;
    minWordLength: number;
    maxCandidates: number;
    maxMs: number;
    scoreWeights?: Partial<ScoreWeights>;
  };
  runs: number;
  targets: Record<string, string>;
}

const GOALS: GoalConfig[] = [
  {
    id: 'default-balanced',
    description: 'Default 5x5 / 5+ play. Diverse, high-word-count boards.',
    weight: 1.0,
    config: { size: 5, minWordLength: 5, maxCandidates: 75, maxMs: 5000 },
    runs: 20,
    targets: {
      'playerRelevantWords.mean': '>= 100',
      'playerRelevantWords.p10': '>= 50',
      'maxWordLength.mean': '>= 6',
      'vowelInventoryEntropyBits': '>= 4.0',
      'letterCoverage': '>= 22',
      'meanElapsedMs': '<= 2000',
    },
  },
  {
    id: 'long-word-heavy',
    description: 'Score biased toward long words.',
    weight: 0.7,
    config: {
      size: 5,
      minWordLength: 5,
      maxCandidates: 75,
      maxMs: 5000,
      scoreWeights: {
        maxWordLength: 12.0,
        averageWordLength: 6.0,
        playerRelevantWords: 0.5,
      },
    },
    runs: 15,
    targets: {
      'maxWordLength.mean': '>= 7',
      'wordsByLength.>=8.mean': '>= 1',
      'playerRelevantWords.mean': '>= 60',
      'vowelInventoryEntropyBits': '>= 3.5',
    },
  },
  {
    id: 'classic-boggle',
    description: '4x4 / 3+ legacy mode.',
    weight: 0.5,
    config: { size: 4, minWordLength: 3, maxCandidates: 50, maxMs: 3000 },
    runs: 15,
    targets: {
      'playerRelevantWords.mean': '>= 60',
      'playerRelevantWords.p10': '>= 30',
      'meanElapsedMs': '<= 2000',
    },
  },
];

interface Stats {
  min: number;
  max: number;
  mean: number;
  p10: number;
  p90: number;
}
const stats = (arr: number[]): Stats => {
  const sorted = [...arr].sort((a, b) => a - b);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: arr.reduce((a, b) => a + b, 0) / arr.length,
    p10: sorted[Math.floor(sorted.length * 0.1)],
    p90: sorted[Math.floor(sorted.length * 0.9)],
  };
};

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
const vowelMultiset = (s: string) =>
  [...s.toLowerCase()].filter((c) => VOWELS.has(c)).sort().join('');
const shannonEntropy = (counts: Map<string, number>, total: number) => {
  let h = 0;
  for (const c of counts.values()) {
    const p = c / total;
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
};

const checkTarget = (value: number, expr: string): { pass: boolean; expr: string; value: number } => {
  const m = expr.match(/^(>=|<=|==|>|<)\s*(-?[0-9.]+)$/);
  if (!m) return { pass: false, expr, value };
  const op = m[1];
  const threshold = parseFloat(m[2]);
  let pass = false;
  switch (op) {
    case '>=': pass = value >= threshold; break;
    case '<=': pass = value <= threshold; break;
    case '==': pass = value === threshold; break;
    case '>': pass = value > threshold; break;
    case '<': pass = value < threshold; break;
  }
  return { pass, expr, value };
};

const filterEnv = process.env.EVAL_GOALS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
const goalsToRun = filterEnv.length > 0 ? GOALS.filter((g) => filterEnv.includes(g.id)) : GOALS;

// MLFLOW_TRACE=1 routes every search.run to the MLflow Tracking Server at
// MLFLOW_OTLP_ENDPOINT (default http://localhost:5000/v1/traces).
const useMlflow = process.env.MLFLOW_TRACE === '1';
const tracer: Tracer | undefined = useMlflow
  ? new MLflowTracer({ experimentName: 'word-finder-eval-v1' })
  : undefined;

it('eval suite v1', async () => {
  const dict = await loadDictionary();
  const trie = buildTrie(dict);
  if (useMlflow) {
    console.log(
      `[eval] MLflow tracing enabled — POSTing to ${process.env.MLFLOW_OTLP_ENDPOINT ?? 'http://localhost:5000/v1/traces'}`
    );
  }

  const report: Array<{
    id: string;
    weight: number;
    runs: number;
    metrics: Record<string, number>;
    checks: Record<string, { pass: boolean; expr: string; value: number }>;
    pass: boolean;
  }> = [];

  for (const g of goalsToRun) {
    const playerRel: number[] = [];
    const maxLen: number[] = [];
    const elapsed: number[] = [];
    const wordsByLen8Plus: number[] = [];
    const vowelMultisets = new Map<string, number>();
    const lettersSeen = new Set<string>();

    for (let i = 0; i < g.runs; i++) {
      const r = searchForBoard({
        size: g.config.size,
        language: Language.English,
        minWordLength: g.config.minWordLength,
        dictionary: dict,
        prebuiltTrie: trie,
        maxCandidates: g.config.maxCandidates,
        maxMs: g.config.maxMs,
        scoreWeights: g.config.scoreWeights,
        tracer,
        goalSignature: g.id,
      });
      playerRel.push(r.score.playerRelevantWords);
      maxLen.push(r.score.maxWordLength);
      elapsed.push(r.elapsedMs);
      const wblen = r.score.wordsByLength;
      let count8 = 0;
      for (const [k, v] of Object.entries(wblen)) {
        if (Number(k) >= 8) count8 += v;
      }
      wordsByLen8Plus.push(count8);
      const ms = vowelMultiset(r.board);
      vowelMultisets.set(ms, (vowelMultisets.get(ms) ?? 0) + 1);
      for (const c of r.board) lettersSeen.add(c);
    }

    const playerRelStats = stats(playerRel);
    const maxLenStats = stats(maxLen);
    const elapsedStats = stats(elapsed);
    const len8Stats = stats(wordsByLen8Plus);
    const vowelEntropy = shannonEntropy(vowelMultisets, g.runs);

    const metrics: Record<string, number> = {
      'playerRelevantWords.mean': playerRelStats.mean,
      'playerRelevantWords.p10': playerRelStats.p10,
      'playerRelevantWords.p90': playerRelStats.p90,
      'maxWordLength.mean': maxLenStats.mean,
      'wordsByLength.>=8.mean': len8Stats.mean,
      'meanElapsedMs': elapsedStats.mean,
      'vowelInventoryEntropyBits': vowelEntropy,
      'letterCoverage': lettersSeen.size,
    };

    const checks: Record<string, { pass: boolean; expr: string; value: number }> = {};
    let allPass = true;
    for (const [field, expr] of Object.entries(g.targets)) {
      const v = metrics[field];
      if (v === undefined) {
        checks[field] = { pass: false, expr, value: NaN };
        allPass = false;
        continue;
      }
      const c = checkTarget(v, expr);
      checks[field] = c;
      if (!c.pass) allPass = false;
    }

    report.push({
      id: g.id,
      weight: g.weight,
      runs: g.runs,
      metrics,
      checks,
      pass: allPass,
    });

    console.log(`\n[${allPass ? 'PASS' : 'FAIL'}] ${g.id}`);
    for (const [field, c] of Object.entries(checks)) {
      const sym = c.pass ? '✓' : '✗';
      console.log(`  ${sym} ${field} ${c.expr}  (actual: ${c.value.toFixed(3)})`);
    }
  }

  // Weighted-mean metric: 1.0 per pass, 0.0 per fail.
  const totalWeight = report.reduce((s, r) => s + r.weight, 0);
  const weightedScore = report.reduce((s, r) => s + r.weight * (r.pass ? 1 : 0), 0);
  const weightedMean = totalWeight > 0 ? weightedScore / totalWeight : 0;

  const summary = {
    runAt: new Date().toISOString(),
    label: process.env.BENCH_LABEL ?? 'eval-v1',
    gitSha: process.env.BENCH_GIT_SHA ?? null,
    weightedMean,
    goals: report,
  };

  mkdirSync('docs/baselines', { recursive: true });
  const ts = summary.runAt.replace(/[:.]/g, '-');
  const path = `docs/baselines/${ts}__${summary.label}.json`;
  writeFileSync(path, JSON.stringify(summary, null, 2));

  console.log(`\nweighted-mean: ${weightedMean.toFixed(3)}`);
  console.log(`Wrote ${path}`);

  // Flush MLflow exports before exit, otherwise async POSTs are dropped
  // when vitest tears the process down.
  if (tracer && tracer instanceof MLflowTracer) {
    await tracer.flush();
    console.log('[eval] MLflow exports flushed');
  }

  // Assert all goals pass — vitest will fail the test if not.
  const failed = report.filter((r) => !r.pass).map((r) => r.id);
  expect(failed, `Failed goals: ${failed.join(', ')}`).toEqual([]);
});
