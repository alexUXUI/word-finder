/**
 * Leaderboard — aggregates per-pipeline-per-goal eval results into a ranked
 * report with paired-bootstrap CIs and a Pareto frontier on (cost, quality).
 *
 * Run via `yarn bench:report` (after `yarn bench` has populated
 * `evals/results/*.json`).
 *
 * Statistical protocol (matches `docs/EVAL_SUITE.md` §promotion):
 *   - per-metric paired-bootstrap (10k resamples) between champion and challenger
 *   - 95% CI on the delta; significance at the 5% level
 *   - Pareto frontier on (usdPerBoard, weightedQuality) across pipelines
 */

import * as fs from 'fs';
import * as path from 'path';

interface BoardResult {
  board: string;
  score: {
    finalScore: number;
    playerRelevantWords: number;
    maxWordLength: number;
    averageWordLength: number;
    vowelRatio: number;
    letterEntropy: number;
    prefixDiversity: number;
  };
  elapsedMs: number;
  modelTokens?: number;
  trace_id?: string;
}

interface BenchRecord {
  pipeline: string;
  pipelineHash: string;
  goal: string;
  runs: number;
  boards: BoardResult[];
  metrics: Record<string, unknown>;
}

interface Cell {
  pipeline: string;
  goal: string;
  runs: number;
  metrics: Record<string, number>;
  perBoardMetrics: Record<string, number[]>;
}

const RESULTS_DIR = path.resolve(process.cwd(), 'evals/results');
const OUT_PATH = path.resolve(process.cwd(), 'evals/leaderboard.json');

const mean = (xs: readonly number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

const stdev = (xs: readonly number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
};

const percentile = (xs: readonly number[], p: number): number => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const i = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

/**
 * Paired bootstrap on the per-board delta `xs - ys`. Returns the mean delta
 * and a 95% CI. Two-tailed p-value is the fraction of resampled means whose
 * sign differs from the observed (null hypothesis: zero delta).
 *
 * `xs` and `ys` must be paired (same goal, same N runs, same RNG seeds where
 * supported). When seeds aren't matched, the bootstrap still gives a
 * reasonable estimate but loses some power.
 */
const pairedBootstrap = (
  xs: readonly number[],
  ys: readonly number[],
  iterations = 10_000
): { delta: number; ci95: [number, number]; p: number } => {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return { delta: 0, ci95: [0, 0], p: 1 };
  const deltas: number[] = [];
  for (let i = 0; i < n; i++) deltas.push(xs[i] - ys[i]);
  const observed = mean(deltas);
  const resampled: number[] = [];
  for (let r = 0; r < iterations; r++) {
    let s = 0;
    for (let k = 0; k < n; k++) {
      s += deltas[Math.floor(Math.random() * n)];
    }
    resampled.push(s / n);
  }
  resampled.sort((a, b) => a - b);
  const lo = resampled[Math.floor(0.025 * iterations)];
  const hi = resampled[Math.floor(0.975 * iterations)];
  // Two-tailed p: fraction with sign opposite the observed (or zero).
  const opposite = resampled.filter((x) =>
    observed > 0 ? x <= 0 : observed < 0 ? x >= 0 : true
  ).length;
  const p = Math.min(1, (2 * opposite) / iterations);
  return { delta: observed, ci95: [lo, hi], p };
};

const loadResults = (): BenchRecord[] => {
  if (!fs.existsSync(RESULTS_DIR)) {
    throw new Error(`no results dir: ${RESULTS_DIR}. Run yarn bench first.`);
  }
  const files = fs.readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json'));
  return files
    .map((f) => {
      const raw = fs.readFileSync(path.join(RESULTS_DIR, f), 'utf-8');
      return JSON.parse(raw) as BenchRecord;
    })
    .sort((a, b) => a.pipeline.localeCompare(b.pipeline) || a.goal.localeCompare(b.goal));
};

const cellFromRecord = (r: BenchRecord): Cell => {
  const player = r.boards.map((b) => b.score.playerRelevantWords);
  const maxLen = r.boards.map((b) => b.score.maxWordLength);
  const avgLen = r.boards.map((b) => b.score.averageWordLength);
  const final = r.boards.map((b) => b.score.finalScore);
  const elapsed = r.boards.map((b) => b.elapsedMs);
  const tokens = r.boards.map((b) => b.modelTokens ?? 0);

  return {
    pipeline: r.pipeline,
    goal: r.goal,
    runs: r.runs,
    metrics: {
      'playerRelevantWords.mean': mean(player),
      'playerRelevantWords.p10': percentile(player, 10),
      'playerRelevantWords.p90': percentile(player, 90),
      'playerRelevantWords.std': stdev(player),
      'maxWordLength.mean': mean(maxLen),
      'averageWordLength.mean': mean(avgLen),
      'finalScore.mean': mean(final),
      'meanElapsedMs': mean(elapsed),
      'modelTokens.mean': mean(tokens),
    },
    perBoardMetrics: {
      playerRelevantWords: player,
      maxWordLength: maxLen,
      finalScore: final,
      elapsedMs: elapsed,
      modelTokens: tokens,
    },
  };
};

const buildLeaderboard = (records: BenchRecord[]): unknown => {
  const cells = records.map(cellFromRecord);
  const pipelines = [...new Set(cells.map((c) => c.pipeline))].sort();
  const goals = [...new Set(cells.map((c) => c.goal))].sort();

  const byPipeline: Record<string, Cell[]> = {};
  for (const c of cells) {
    (byPipeline[c.pipeline] ??= []).push(c);
  }

  const aggPerPipeline = pipelines.map((p) => {
    const cs = byPipeline[p];
    const flat = (key: string): number[] => cs.flatMap((c) => c.perBoardMetrics[key] ?? []);
    return {
      pipeline: p,
      runs: cs.reduce((s, c) => s + c.runs, 0),
      goalsCovered: cs.length,
      'playerRelevantWords.mean': mean(flat('playerRelevantWords')),
      'finalScore.mean': mean(flat('finalScore')),
      'meanElapsedMs': mean(flat('elapsedMs')),
      'modelTokens.mean': mean(flat('modelTokens')),
    };
  });

  // Pairwise paired-bootstrap on `playerRelevantWords` per goal.
  const pairwise: unknown[] = [];
  for (let i = 0; i < pipelines.length; i++) {
    for (let j = 0; j < pipelines.length; j++) {
      if (i === j) continue;
      const champ = pipelines[i];
      const chal = pipelines[j];
      for (const g of goals) {
        const c1 = cells.find((c) => c.pipeline === champ && c.goal === g);
        const c2 = cells.find((c) => c.pipeline === chal && c.goal === g);
        if (!c1 || !c2) continue;
        const r = pairedBootstrap(
          c2.perBoardMetrics.playerRelevantWords,
          c1.perBoardMetrics.playerRelevantWords
        );
        pairwise.push({
          champion: champ,
          challenger: chal,
          goal: g,
          metric: 'playerRelevantWords',
          delta: r.delta,
          ci95: r.ci95,
          p: r.p,
          significant: r.p < 0.05 && (r.ci95[0] > 0 || r.ci95[1] < 0),
        });
      }
    }
  }

  // Pareto frontier on (cost, quality). Simple: dominated points marked.
  const points = aggPerPipeline.map((a) => ({
    pipeline: a.pipeline,
    cost: a['meanElapsedMs'] + a['modelTokens.mean'] * 0.001, // proxy until $ pricing
    quality: a['playerRelevantWords.mean'],
  }));
  const dominated = new Set<string>();
  for (const a of points) {
    for (const b of points) {
      if (a.pipeline === b.pipeline) continue;
      if (b.cost <= a.cost && b.quality >= a.quality && (b.cost < a.cost || b.quality > a.quality)) {
        dominated.add(a.pipeline);
        break;
      }
    }
  }
  const pareto = points.map((p) => ({ ...p, paretoFrontier: !dominated.has(p.pipeline) }));

  return {
    generatedAt: new Date().toISOString(),
    pipelines,
    goals,
    aggregate: aggPerPipeline,
    pairwise,
    pareto,
    cells: cells.map((c) => ({
      pipeline: c.pipeline,
      goal: c.goal,
      runs: c.runs,
      metrics: c.metrics,
    })),
  };
};

const formatTable = (rows: Record<string, number | string>[]): string => {
  if (rows.length === 0) return '(empty)';
  const cols = Object.keys(rows[0]);
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
  const fmt = (vals: (string | number)[]) =>
    vals.map((v, i) => String(v).padEnd(widths[i])).join('  ');
  return [fmt(cols), fmt(cols.map((_, i) => '-'.repeat(widths[i]))), ...rows.map((r) => fmt(cols.map((c) => r[c])))].join('\n');
};

const main = (): void => {
  const records = loadResults();
  const board = buildLeaderboard(records) as Record<string, unknown>;
  fs.writeFileSync(OUT_PATH, JSON.stringify(board, null, 2));

  const agg = board.aggregate as Record<string, number | string>[];
  console.log('\n=== Aggregate (mean across all goals) ===');
  console.log(
    formatTable(
      agg.map((r) => ({
        pipeline: r.pipeline,
        runs: r.runs,
        goalsCovered: r.goalsCovered,
        playerRelevantWords: typeof r['playerRelevantWords.mean'] === 'number' ? (r['playerRelevantWords.mean'] as number).toFixed(1) : r['playerRelevantWords.mean'],
        finalScore: typeof r['finalScore.mean'] === 'number' ? (r['finalScore.mean'] as number).toFixed(1) : r['finalScore.mean'],
        elapsedMs: typeof r['meanElapsedMs'] === 'number' ? (r['meanElapsedMs'] as number).toFixed(0) : r['meanElapsedMs'],
      }))
    )
  );

  const pareto = board.pareto as Array<{ pipeline: string; cost: number; quality: number; paretoFrontier: boolean }>;
  console.log('\n=== Pareto frontier (cost vs quality) ===');
  console.log(
    formatTable(
      pareto.map((p) => ({
        pipeline: p.pipeline,
        cost: p.cost.toFixed(1),
        quality: p.quality.toFixed(1),
        frontier: p.paretoFrontier ? '✓' : '',
      }))
    )
  );

  const pw = board.pairwise as Array<{
    champion: string;
    challenger: string;
    goal: string;
    metric: string;
    delta: number;
    ci95: [number, number];
    p: number;
    significant: boolean;
  }>;
  const wins = pw.filter((p) => p.significant && p.delta > 0);
  if (wins.length) {
    console.log('\n=== Significant wins (challenger > champion, p<0.05) ===');
    console.log(
      formatTable(
        wins.map((w) => ({
          champion: w.champion,
          challenger: w.challenger,
          goal: w.goal,
          delta: w.delta.toFixed(1),
          ci: `[${w.ci95[0].toFixed(1)}, ${w.ci95[1].toFixed(1)}]`,
          p: w.p.toFixed(3),
        }))
      )
    );
  } else {
    console.log('\n=== No significant pairwise wins yet (p<0.05). ===');
  }

  console.log(`\nWrote: ${OUT_PATH}`);
};

main();
