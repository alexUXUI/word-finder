/**
 * Bench runner — executes every registered pipeline against every goal in
 * `goals.yaml`, writes per-pipeline-per-goal results to
 * `evals/results/<ts>__<pipeline>__<goal>.json`. The leaderboard
 * (`leaderboard.ts`) consumes the results dir.
 *
 * Defaults to MockProvider so CI doesn't depend on a model download. Flip
 * `BENCH_USE_REAL_MODEL=1` to use a real provider via TransformersJsProvider
 * when running locally with the model already cached.
 *
 * Flags:
 *   --pipeline=<id>    only run this pipeline
 *   --goal=<id>        only run this goal
 *   --runs=<N>         override goal's runs count (useful for `--runs=3` smoke)
 *   --quick            shortcut for `--runs=3` and a single goal
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { fileURLToPath } from 'url';

import { runPipeline } from '../src/components/boggle/intelligence/pipeline/runner';
import { listPipelines, getPipeline } from '../src/components/boggle/intelligence/pipeline/registry';
import { initializePipelines } from '../src/components/boggle/intelligence/pipelines';
import { pipelineHash } from '../src/components/boggle/intelligence/pipeline/types';
import { NoopTracer } from '../src/components/boggle/generation/trace';
import { makeMockProvider } from '../src/components/boggle/intelligence/local-model/mock';
import { setProviderForId } from '../src/components/boggle/intelligence/local-model/factory';
import { SLM_REGISTRY } from '../src/components/boggle/intelligence/local-model/device-tier';
import { Language } from '../src/components/boggle/models';

interface GoalConfig {
  id: string;
  category: string;
  description?: string;
  weight: number;
  runs: number;
  config: {
    size: number;
    minWordLength: number;
    language: 'English' | 'Russian' | 'Spanish';
    style?: string;
    requiredLetters?: string[];
    avoidedLetters?: string[];
    extra?: Record<string, unknown>;
  };
  targets?: Record<string, string>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const GOALS_PATH = path.join(REPO_ROOT, 'evals/goals.yaml');
const RESULTS_DIR = path.join(REPO_ROOT, 'evals/results');
const DICTIONARY_URL = 'https://boggle.pages.dev/engmix.txt';

const flagValue = (name: string): string | undefined => {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : undefined;
};

const hasFlag = (name: string): boolean =>
  process.argv.includes(`--${name}`);

const loadGoals = (): GoalConfig[] => {
  const raw = fs.readFileSync(GOALS_PATH, 'utf-8');
  return yaml.parse(raw) as GoalConfig[];
};

const loadDictionary = async (): Promise<readonly string[]> => {
  // Use a tiny embedded dictionary as a cheap fallback if the network is not
  // available — just enough words for the search engine to find some.
  // CI will set DICT_PATH to a local file if it's been pre-fetched.
  const localPath = process.env.DICT_PATH;
  if (localPath && fs.existsSync(localPath)) {
    return fs.readFileSync(localPath, 'utf-8').split('\n').map((w) => w.trim().toLowerCase()).filter(Boolean);
  }
  try {
    const r = await fetch(DICTIONARY_URL);
    if (!r.ok) throw new Error(`status ${r.status}`);
    const text = await r.text();
    return text.split('\n').map((w) => w.trim().toLowerCase()).filter(Boolean);
  } catch (e) {
    console.warn(`[bench] dictionary fetch failed (${(e as Error).message}); using seed wordlist`);
    return SEED_DICT;
  }
};

// Tiny offline fallback so the bench can run without network. Real bench
// always fetches engmix.txt.
const SEED_DICT: readonly string[] = [
  'boggle','letter','game','play','word','grid','find','search','match','wisdom',
  'serpent','crystal','manage','random','phrase','bright','flight','people','strong',
  'castle','heart','glass','stone','river','ocean','dragon','garden','window','bridge',
];

const runOne = async (
  pipelineId: string,
  goal: GoalConfig,
  runs: number,
  dictionary: readonly string[]
): Promise<void> => {
  const pipeline = getPipeline(pipelineId);
  if (!pipeline) {
    console.warn(`[bench] unknown pipeline: ${pipelineId}`);
    return;
  }

  const useReal = process.env.BENCH_USE_REAL_MODEL === '1';
  const model = useReal ? null : makeMockProvider({ id: 'mock-bench' });
  if (model) await model.load();

  // Trace capture for distillation. CAPTURE_TRACES=path/to/file.jsonl
  // appends one JSON record per role.model.generate call, with the
  // outcome (final score, player words, floor met) attached after the
  // pipeline completes. See docs/DISTILLATION.md.
  let captureFh: number | null = null;
  const capturePath = process.env.CAPTURE_TRACES;
  if (capturePath) {
    const dir = path.dirname(path.resolve(REPO_ROOT, capturePath));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    captureFh = fs.openSync(path.resolve(REPO_ROOT, capturePath), 'a');
    console.log(`[bench] capturing traces to ${capturePath}`);
  }
  const captureTraces = captureFh
    ? (rec: unknown): void => {
        fs.writeSync(captureFh!, JSON.stringify(rec) + '\n');
      }
    : undefined;

  if (!useReal) {
    // Pre-register mocks for every SLM id so pipelines like p06-cascade
    // and p07-self-consistent (which call getProviderForId directly to
    // walk a model ladder) don't try to dynamic-import Transformers.js
    // in Node. Each mock is independent so role-level model overrides
    // still produce different `model_id` attributes in spans.
    for (const entry of SLM_REGISTRY) {
      const m = makeMockProvider({ id: `mock:${entry.id}` });
      await m.load();
      setProviderForId(entry.id, m);
    }
  }

  const boards: unknown[] = [];
  const t0 = Date.now();
  for (let i = 0; i < runs; i++) {
    const result = await runPipeline(pipeline, {
      goal: {
        size: goal.config.size,
        minWordLength: goal.config.minWordLength,
        language: goal.config.language as 'English' | 'Russian' | 'Spanish' as unknown as typeof Language.English,
        style: goal.config.style as never,
        requiredLetters: goal.config.requiredLetters,
        avoidedLetters: goal.config.avoidedLetters,
      },
      dictionary,
      model: model ?? undefined,
      tracer: NoopTracer,
      captureTraces: captureTraces as never,
    });
    boards.push({
      board: result.board,
      score: {
        finalScore: result.score.finalScore,
        playerRelevantWords: result.score.playerRelevantWords,
        maxWordLength: result.score.maxWordLength,
        averageWordLength: result.score.averageWordLength,
        vowelRatio: result.score.vowelRatio,
        letterEntropy: result.score.letterEntropy,
        prefixDiversity: result.score.prefixDiversity,
      },
      elapsedMs: result.elapsedMs,
      modelTokens: result.modelCalls * 50, // proxy until provider exposes token counts
    });
    process.stdout.write(`\r[bench] ${pipelineId} / ${goal.id}: ${i + 1}/${runs} `);
  }
  process.stdout.write('\n');

  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(RESULTS_DIR, `${ts}__${pipelineId}__${goal.id}.json`);
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        pipeline: pipelineId,
        pipelineHash: pipelineHash(pipeline),
        goal: goal.id,
        runs,
        boards,
        wallMs: Date.now() - t0,
        usedRealModel: useReal,
      },
      null,
      2
    )
  );
  console.log(`[bench] wrote ${path.relative(REPO_ROOT, out)}`);
};

const main = async (): Promise<void> => {
  initializePipelines();
  const allPipelines = listPipelines();
  const allGoals = loadGoals();

  const onePipeline = flagValue('pipeline');
  const oneGoal = flagValue('goal');
  const overrideRuns = flagValue('runs');
  const quick = hasFlag('quick');

  const pipelinesToRun = onePipeline
    ? allPipelines.filter((p) => p.id === onePipeline)
    : allPipelines;
  const goalsToRun = oneGoal
    ? allGoals.filter((g) => g.id === oneGoal)
    : quick
      ? allGoals.slice(0, 1)
      : allGoals;

  if (pipelinesToRun.length === 0) {
    console.error(`[bench] no pipelines matched`);
    process.exit(1);
  }
  if (goalsToRun.length === 0) {
    console.error(`[bench] no goals matched`);
    process.exit(1);
  }

  console.log(`[bench] pipelines: ${pipelinesToRun.map((p) => p.id).join(', ')}`);
  console.log(`[bench] goals: ${goalsToRun.map((g) => g.id).join(', ')}`);

  const dictionary = await loadDictionary();
  console.log(`[bench] dictionary: ${dictionary.length} words`);

  for (const p of pipelinesToRun) {
    for (const g of goalsToRun) {
      const runs = quick ? 3 : Number(overrideRuns ?? g.runs);
      await runOne(p.id, g, runs, dictionary);
    }
  }
  console.log(`[bench] done. Run \`yarn bench:report\` to see the leaderboard.`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
