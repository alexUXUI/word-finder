/**
 * Prompt optimizer (algorithm G — deterministic v0).
 *
 * Given a target role + a goal, generates prompt variants via preset
 * mutations, runs a mini-bench (N boards) against each, ranks by
 * playerRelevantWords mean. Reports top 3 + writes a JSON artifact.
 *
 * Manual promotion: copy the winning variant's text into the canonical
 * prompts/<role>.ts file and bump the *_PROMPT_VERSION constant. Re-run
 * the full bench (yarn bench) to confirm the win persists across goals
 * before merging.
 *
 * Usage:
 *   yarn optimize:prompt --role=mutator --goal=default-balanced --runs=3
 *   yarn optimize:prompt --role=router --runs=2 --quick
 *
 * Args:
 *   --role     mutator | router  (which prompt to optimize)
 *   --goal     id from evals/goals.yaml (default: default-balanced)
 *   --runs     boards per variant (default 5; smaller for speed)
 *   --pipeline pipeline id to compose around the variant role
 *              (default: p02-slm-mutator for role=mutator, p01-smart-router for router)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'yaml';

import { runPipeline } from '../../src/components/boggle/intelligence/pipeline/runner';
import { initializePipelines } from '../../src/components/boggle/intelligence/pipelines';
import { setProviderForId } from '../../src/components/boggle/intelligence/local-model/factory';
import { SLM_REGISTRY } from '../../src/components/boggle/intelligence/local-model/device-tier';
import { makeMockProvider } from '../../src/components/boggle/intelligence/local-model/mock';
import { NoopTracer } from '../../src/components/boggle/generation/trace';
import { Language } from '../../src/components/boggle/models';

import { makeSlmRouterWithOverride } from '../../src/components/boggle/intelligence/roles/strategy-router/slm-router';
import { makeSlmSwapMutatorWithOverride } from '../../src/components/boggle/intelligence/roles/mutator/slm-swap';
import { noopPromptParser } from '../../src/components/boggle/intelligence/roles/prompt-parser/noop';
import { makeBestOfNGenerator } from '../../src/components/boggle/intelligence/roles/candidate-generator/best-of-n';
import { makeRuleBasedRouter } from '../../src/components/boggle/intelligence/roles/strategy-router/rule-based';
import { makeDeterministicCritic } from '../../src/components/boggle/intelligence/roles/critic/deterministic';
import { argmaxAggregator } from '../../src/components/boggle/intelligence/roles/aggregator/argmax';
import { slmNarrator } from '../../src/components/boggle/intelligence/roles/narrator/slm-narrator';

import {
  PICK_STRATEGY_SYSTEM,
} from '../../src/components/boggle/intelligence/prompts/router';
import { MUTATOR_SYSTEM } from '../../src/components/boggle/intelligence/prompts/mutator';

import type { Pipeline } from '../../src/components/boggle/intelligence/pipeline/types';
import { generateVariants, type PromptVariant } from './mutations';
import { logRun, isMlflowProxyReachable } from '../../evals/mlflow-client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const RESULTS_DIR = path.join(REPO_ROOT, 'tools/optimizer/results');

interface GoalConfig {
  id: string;
  config: { size: number; minWordLength: number; language: string; style?: string };
  runs: number;
}

const arg = (name: string, def?: string): string | undefined => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};

const buildPipelineFor = (role: string, variantText: string): Pipeline => {
  switch (role) {
    case 'mutator':
      return {
        id: `optimizer:p02-with-mutator-variant`,
        version: '0.0.0',
        description: 'Optimizer pipeline — p02 with overridden mutator prompt',
        roles: {
          promptParser: noopPromptParser,
          strategyRouter: makeRuleBasedRouter({ default: 'frequency-weighted' }),
          candidateGenerator: makeBestOfNGenerator({ samples: 25, maxMs: 3000 }),
          mutator: makeSlmSwapMutatorWithOverride({ promptOverride: variantText }),
          critic: makeDeterministicCritic(),
          aggregator: argmaxAggregator,
          narrator: slmNarrator,
        },
        mutationLoop: {
          iterations: 4,
          swapsPerIteration: 3,
          acceptOnlyImprovements: true,
        },
      };
    case 'router':
      return {
        id: `optimizer:p01-with-router-variant`,
        version: '0.0.0',
        description: 'Optimizer pipeline — p01 with overridden router prompt',
        roles: {
          promptParser: noopPromptParser,
          strategyRouter: makeSlmRouterWithOverride({ promptOverride: variantText }),
          candidateGenerator: makeBestOfNGenerator({ samples: 50, maxMs: 4000 }),
          critic: makeDeterministicCritic(),
          aggregator: argmaxAggregator,
          narrator: slmNarrator,
        },
      };
    default:
      throw new Error(`Unknown role: ${role}. Supported: mutator, router.`);
  }
};

const baselineFor = (role: string): string => {
  switch (role) {
    case 'mutator':
      return MUTATOR_SYSTEM;
    case 'router':
      return PICK_STRATEGY_SYSTEM;
    default:
      throw new Error(`Unknown role: ${role}`);
  }
};

const loadGoal = (id: string): GoalConfig => {
  const goals = yaml.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'evals/goals.yaml'), 'utf-8')
  ) as GoalConfig[];
  const g = goals.find((x) => x.id === id);
  if (!g) throw new Error(`Goal "${id}" not in evals/goals.yaml`);
  return g;
};

interface VariantResult {
  variant: PromptVariant;
  runs: number;
  meanPlayerWords: number;
  minPlayerWords: number;
  maxPlayerWords: number;
  meanFinalScore: number;
  meanElapsedMs: number;
  promptLength: number;
}

const main = async (): Promise<void> => {
  const role = arg('role') ?? 'mutator';
  const goalId = arg('goal') ?? 'default-balanced';
  const runs = parseInt(arg('runs') ?? '5');
  const useReal = process.env.BENCH_USE_REAL_MODEL === '1';

  console.log(`[optimize] role=${role}  goal=${goalId}  runs=${runs}  realModel=${useReal}`);

  initializePipelines();

  // Pre-register mocks for every SLM id so cascade / self-consistent
  // pipelines work without a real model in Node.
  if (!useReal) {
    for (const e of SLM_REGISTRY) {
      const m = makeMockProvider({ id: `mock:${e.id}` });
      await m.load();
      setProviderForId(e.id, m);
    }
  }

  const baseline = baselineFor(role);
  const variants = generateVariants(baseline);
  const goal = loadGoal(goalId);

  // MLflow integration. Each optimizer invocation creates a parent run
  // tagged "optimizer.<role>.<goal>"; each variant becomes a child run
  // with the prompt text as an artifact and bench metrics. Browse the
  // experiment at http://localhost:5000 (start with `mlflow server
  // --port 5000` + `yarn mlflow.proxy`).
  const mlflowReachable = await isMlflowProxyReachable();
  if (mlflowReachable) {
    console.log(`[optimize] MLflow proxy reachable — logging runs.`);
  } else {
    console.log(
      `[optimize] MLflow proxy not reachable (start with: mlflow server --port 5000 && yarn mlflow.proxy). Continuing without MLflow logging.`
    );
  }
  const parentRunResult = mlflowReachable
    ? await logRun({
        experiment: `word-finder-optimizer`,
        runName: `optimize:${role}:${goalId}:${new Date().toISOString().slice(0, 19)}`,
        tags: {
          'word_finder.kind': 'optimizer',
          'word_finder.role': role,
          'word_finder.goal': goalId,
          'word_finder.variants': variants.length,
        },
        params: {
          role,
          goal: goalId,
          runs_per_variant: runs,
          baseline_chars: baseline.length,
          variants: variants.length,
          used_real_model: useReal,
        },
        status: 'RUNNING',
      })
    : { runId: null, ok: false };
  const parentRunId = parentRunResult.runId;

  // Tiny offline dictionary; fetch real engmix.txt only when invoked
  // outside CI. Keeps optimizer runnable without network.
  const dict = await (async (): Promise<readonly string[]> => {
    if (process.env.DICT_PATH && fs.existsSync(process.env.DICT_PATH)) {
      return fs
        .readFileSync(process.env.DICT_PATH, 'utf-8')
        .split('\n')
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean);
    }
    try {
      const r = await fetch('https://boggle.pages.dev/engmix.txt');
      if (!r.ok) throw new Error(`status ${r.status}`);
      return (await r.text())
        .split('\n')
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean);
    } catch {
      console.warn('[optimize] dict fetch failed; using stub');
      return ['castle', 'people', 'finger', 'water', 'house', 'world', 'plant', 'phase'];
    }
  })();
  console.log(`[optimize] dict: ${dict.length} words`);

  const model = makeMockProvider({ id: 'mock-optimizer' });
  await model.load();

  const out: VariantResult[] = [];
  for (const v of variants) {
    process.stdout.write(`[optimize] variant ${v.id} (${v.label})… `);
    const pipeline = buildPipelineFor(role, v.text);
    const playerWords: number[] = [];
    const finalScores: number[] = [];
    const elapsedMs: number[] = [];
    for (let i = 0; i < runs; i++) {
      const r = await runPipeline(pipeline, {
        goal: {
          size: goal.config.size,
          minWordLength: goal.config.minWordLength,
          language: Language.English,
          style: goal.config.style as never,
        },
        dictionary: dict,
        model,
        tracer: NoopTracer,
      });
      playerWords.push(r.score.playerRelevantWords);
      finalScores.push(r.score.finalScore);
      elapsedMs.push(r.elapsedMs);
    }
    const mean = (xs: number[]): number =>
      xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    const meanPw = mean(playerWords);
    out.push({
      variant: v,
      runs,
      meanPlayerWords: meanPw,
      minPlayerWords: Math.min(...playerWords),
      maxPlayerWords: Math.max(...playerWords),
      meanFinalScore: mean(finalScores),
      meanElapsedMs: mean(elapsedMs),
      promptLength: v.text.length,
    });
    console.log(`mean=${meanPw.toFixed(1)}`);

    // Per-variant child run.
    if (mlflowReachable && parentRunId) {
      await logRun({
        experiment: `word-finder-optimizer`,
        runName: `${v.id}:${v.label}`,
        parentRunId,
        tags: {
          'word_finder.kind': 'optimizer.variant',
          'word_finder.role': role,
          'word_finder.variant_id': v.id,
          'word_finder.variant_label': v.label,
        },
        params: {
          role,
          goal: goalId,
          variant_id: v.id,
          variant_label: v.label,
          prompt_chars: v.text.length,
          runs,
        },
        metrics: {
          'playerRelevantWords.mean': meanPw,
          'playerRelevantWords.min': Math.min(...playerWords),
          'playerRelevantWords.max': Math.max(...playerWords),
          'finalScore.mean': mean(finalScores),
          'elapsedMs.mean': mean(elapsedMs),
          // Per-board metric history so MLflow draws a step plot.
          'playerRelevantWords.history': playerWords.map((value, step) => ({
            value,
            step,
          })),
        },
        artifacts: {
          [`${v.id}.txt`]: v.text,
        },
      });
    }
  }

  out.sort((a, b) => b.meanPlayerWords - a.meanPlayerWords);

  // Report
  console.log(`\n=== Variants ranked by mean playerRelevantWords (goal=${goalId}, n=${runs}/variant) ===`);
  for (const r of out) {
    console.log(
      `  ${r.variant.id.padEnd(20)}  mean=${r.meanPlayerWords.toFixed(1).padStart(6)}  min=${r.minPlayerWords.toString().padStart(4)}  max=${r.maxPlayerWords.toString().padStart(4)}  ms=${r.meanElapsedMs.toFixed(0)}  chars=${r.promptLength}`
    );
  }

  const baselineRow = out.find((x) => x.variant.id === 'baseline');
  if (baselineRow) {
    const winners = out.filter(
      (x) => x.variant.id !== 'baseline' && x.meanPlayerWords > baselineRow.meanPlayerWords
    );
    if (winners.length === 0) {
      console.log(`\n[optimize] No variant beat the baseline (mean=${baselineRow.meanPlayerWords.toFixed(1)}).`);
    } else {
      console.log(`\n[optimize] ${winners.length} variant(s) beat baseline (mean=${baselineRow.meanPlayerWords.toFixed(1)}):`);
      for (const w of winners) {
        console.log(`  ${w.variant.id} → +${(w.meanPlayerWords - baselineRow.meanPlayerWords).toFixed(1)} words`);
      }
    }
  }

  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const out_path = path.join(RESULTS_DIR, `${ts}__${role}__${goalId}.json`);
  fs.writeFileSync(
    out_path,
    JSON.stringify(
      {
        role,
        goal: goalId,
        runs,
        usedRealModel: useReal,
        baselineLength: baseline.length,
        variants: out,
      },
      null,
      2
    )
  );
  console.log(`\nWrote: ${path.relative(REPO_ROOT, out_path)}`);

  // Close out the parent run with summary metrics.
  if (mlflowReachable && parentRunId) {
    const baselineRow = out.find((x) => x.variant.id === 'baseline');
    const winnerRow = out[0];
    await logRun({
      experiment: `word-finder-optimizer`,
      runName: `optimize:${role}:${goalId}:summary`,
      parentRunId,
      tags: {
        'word_finder.kind': 'optimizer.summary',
        'word_finder.winner_id': winnerRow?.variant.id ?? '',
      },
      params: {
        winner: winnerRow?.variant.id ?? '',
        beat_baseline:
          baselineRow && winnerRow
            ? winnerRow.meanPlayerWords > baselineRow.meanPlayerWords
            : false,
      },
      metrics: {
        'baseline.meanPlayerWords': baselineRow?.meanPlayerWords ?? 0,
        'winner.meanPlayerWords': winnerRow?.meanPlayerWords ?? 0,
        'delta.meanPlayerWords':
          baselineRow && winnerRow
            ? winnerRow.meanPlayerWords - baselineRow.meanPlayerWords
            : 0,
      },
    });
    console.log(
      `\nView in MLflow: http://localhost:5000  (experiment: word-finder-optimizer)`
    );
  }

  console.log(
    `\nTo promote a variant: copy its text into prompts/${role}.ts (replace the *_SYSTEM constant), bump *_PROMPT_VERSION, run \`yarn bench\`, validate the win persists across goals before merging.`
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
