/**
 * Calibration step. Loads human ratings from `evals/ratings.json` (player
 * exports from the dashboard's ⬇ button), runs the SLM judge against each
 * rated board, computes Spearman ρ + ECE + pairwise agreement, writes
 * `evals/calibration.json`.
 *
 * Until the judge passes calibration thresholds, the leaderboard reports
 * its `goalAdherence` rating but does NOT use it for promotion gating.
 *
 * Thresholds (from `EVAL_SUITE.md` §calibration):
 *   - ≥ 200 ratings (sample size)
 *   - Spearman ρ ≥ 0.5
 *   - ECE ≤ 0.15
 *   - Pairwise agreement ≥ 0.65
 *
 * Below thresholds → judge non-binding. Equal-or-above → judge binding,
 * `goalAdherence` enters the promotion-gate decision.
 *
 * Run: `yarn bench:calibrate` (mock SLM by default; real via
 * `BENCH_USE_REAL_MODEL=1` once that path is available in Node — for now
 * the mock provides infrastructure only).
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { slmJudgeCritic } from '../src/components/boggle/intelligence/roles/critic/slm-judge';
import { makeMockProvider } from '../src/components/boggle/intelligence/local-model/mock';
import { NoopTracer } from '../src/components/boggle/generation/trace';
import { DEFAULT_WEIGHTS } from '../src/components/boggle/generation/scorer';
import { Language } from '../src/components/boggle/models';
import { scoreBoard } from '../src/components/boggle/generation/scorer';
import { buildTrie } from '../src/components/boggle/logic/trie';
import { solveWithTrie } from '../src/components/boggle/logic/boggle';

interface RatingEntry {
  pipelineId: string;
  board: string;
  goalSignature: string;
  goalDescription?: string;
  rating: number; // [0,1] human
  capturedAt: string;
}

interface JudgedRating extends RatingEntry {
  judgeRating: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const RATINGS_PATH = path.join(REPO_ROOT, 'evals/ratings.json');
const CALIBRATION_PATH = path.join(REPO_ROOT, 'evals/calibration.json');

/** Spearman rank correlation between two equal-length numeric arrays. */
const spearman = (xs: readonly number[], ys: readonly number[]): number => {
  const n = xs.length;
  if (n < 2) return 0;
  const rank = (vals: readonly number[]): number[] => {
    const indexed = vals.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => a.v - b.v);
    const ranks = new Array<number>(n);
    for (let k = 0; k < n; ) {
      let j = k;
      while (j + 1 < n && indexed[j + 1].v === indexed[k].v) j++;
      // Average ranks for ties: (k+1 .. j+1) → (k+j+2)/2
      const avg = (k + j + 2) / 2;
      for (let t = k; t <= j; t++) ranks[indexed[t].i] = avg;
      k = j + 1;
    }
    return ranks;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const meanX = rx.reduce((a, b) => a + b, 0) / n;
  const meanY = ry.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    cov += (rx[i] - meanX) * (ry[i] - meanY);
    varX += (rx[i] - meanX) ** 2;
    varY += (ry[i] - meanY) ** 2;
  }
  if (varX === 0 || varY === 0) return 0;
  return cov / Math.sqrt(varX * varY);
};

/**
 * Expected Calibration Error: bin judge ratings into B bins, compute the
 * mean human rating per bin, return weighted absolute error. Lower = better
 * calibrated (judge confidence matches human reality).
 */
const ece = (
  judge: readonly number[],
  human: readonly number[],
  bins = 10
): number => {
  const n = judge.length;
  if (n === 0) return 0;
  const buckets: Array<{ js: number[]; hs: number[] }> = Array.from(
    { length: bins },
    () => ({ js: [], hs: [] })
  );
  for (let i = 0; i < n; i++) {
    const b = Math.min(bins - 1, Math.floor(judge[i] * bins));
    buckets[b].js.push(judge[i]);
    buckets[b].hs.push(human[i]);
  }
  let total = 0;
  for (const b of buckets) {
    if (b.js.length === 0) continue;
    const judgeMean = b.js.reduce((a, x) => a + x, 0) / b.js.length;
    const humanMean = b.hs.reduce((a, x) => a + x, 0) / b.hs.length;
    total += (b.js.length / n) * Math.abs(judgeMean - humanMean);
  }
  return total;
};

/**
 * Pairwise agreement: across all (i, j) pairs, fraction where the judge
 * and human agree on which is better. Strong sanity check that doesn't
 * require absolute calibration.
 */
const pairwiseAgreement = (
  judge: readonly number[],
  human: readonly number[]
): number => {
  const n = judge.length;
  if (n < 2) return 0;
  let pairs = 0;
  let agree = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dj = judge[i] - judge[j];
      const dh = human[i] - human[j];
      if (dj === 0 && dh === 0) continue; // skip ties on both sides
      pairs++;
      if (Math.sign(dj) === Math.sign(dh)) agree++;
    }
  }
  return pairs === 0 ? 0 : agree / pairs;
};

const loadDictionary = (): readonly string[] => {
  const localPath = process.env.DICT_PATH;
  if (localPath && fs.existsSync(localPath)) {
    return fs
      .readFileSync(localPath, 'utf-8')
      .split('\n')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
  }
  // Tiny offline fallback — judge runs even without engmix.txt.
  return [
    'about','after','again','below','board','clean','enter','field','great','heart',
    'house','large','light','match','never','party','phase','plant','quite','river',
    'shape','share','small','still','stone','study','table','train','under','water',
  ];
};

const judgeRatings = async (ratings: RatingEntry[]): Promise<JudgedRating[]> => {
  const useReal = process.env.BENCH_USE_REAL_MODEL === '1';
  const model = makeMockProvider({
    id: useReal ? 'mock-fallback-real' : 'mock-calibrate',
    // Mock returns rating: 0.5 always, so calibration on mock is a no-op
    // but the infrastructure runs end-to-end.
  });
  await model.load();
  const dict = loadDictionary();
  const trie = buildTrie([...dict]);

  const out: JudgedRating[] = [];
  for (const r of ratings) {
    const words = solveWithTrie(trie, r.board.split(''));
    const score = scoreBoard(r.board, words, {
      minWordLength: 5,
      weights: DEFAULT_WEIGHTS,
    });
    const judgeRating = await slmJudgeCritic.rate({
      board: { board: r.board, words, score, source: 'calibration' },
      goal: {
        size: Math.round(Math.sqrt(r.board.length)),
        minWordLength: 5,
        language: Language.English,
        description: r.goalDescription,
      },
      ctx: {
        trace: NoopTracer,
        model,
        dictionary: dict,
        scoreWeights: DEFAULT_WEIGHTS,
      },
    });
    out.push({ ...r, judgeRating });
  }
  return out;
};

const main = async (): Promise<void> => {
  if (!fs.existsSync(RATINGS_PATH)) {
    console.error(
      `[calibrate] ${RATINGS_PATH} not found. Click the ⬇ export button on` +
        ` the dashboard with at least one rating, then move the downloaded` +
        ` file to evals/ratings.json.`
    );
    process.exit(2);
  }
  const ratings = JSON.parse(
    fs.readFileSync(RATINGS_PATH, 'utf-8')
  ) as RatingEntry[];
  if (!Array.isArray(ratings) || ratings.length === 0) {
    console.error('[calibrate] ratings file is empty');
    process.exit(2);
  }
  console.log(`[calibrate] loaded ${ratings.length} ratings`);

  const judged = await judgeRatings(ratings);
  const judge = judged.map((r) => r.judgeRating);
  const human = judged.map((r) => r.rating);

  const rho = spearman(judge, human);
  const ec = ece(judge, human);
  const agreement = pairwiseAgreement(judge, human);

  // Thresholds — see `docs/EVAL_SUITE.md` §calibration.
  const thresholds = { samples: 200, spearman: 0.5, ece: 0.15, agreement: 0.65 };
  const binding =
    ratings.length >= thresholds.samples &&
    rho >= thresholds.spearman &&
    ec <= thresholds.ece &&
    agreement >= thresholds.agreement;

  const report = {
    generatedAt: new Date().toISOString(),
    samples: ratings.length,
    spearman: rho,
    ece: ec,
    pairwiseAgreement: agreement,
    thresholds,
    binding,
    note: binding
      ? 'Judge is calibrated: goalAdherence binding for promotion gating.'
      : `Judge non-binding. Need ≥${thresholds.samples} samples (have ${ratings.length}), spearman ≥ ${thresholds.spearman} (have ${rho.toFixed(3)}), ECE ≤ ${thresholds.ece} (have ${ec.toFixed(3)}), agreement ≥ ${thresholds.agreement} (have ${agreement.toFixed(3)}).`,
  };
  fs.writeFileSync(CALIBRATION_PATH, JSON.stringify(report, null, 2));

  console.log('\n=== Calibration ===');
  console.log(`samples:    ${report.samples}`);
  console.log(`spearman:   ${rho.toFixed(3)}  (need ≥ ${thresholds.spearman})`);
  console.log(`ece:        ${ec.toFixed(3)}  (need ≤ ${thresholds.ece})`);
  console.log(`agreement:  ${agreement.toFixed(3)}  (need ≥ ${thresholds.agreement})`);
  console.log(`binding:    ${binding ? 'YES — judge enters promotion gates' : 'NO — judge non-binding'}`);
  console.log(`\nWrote: ${CALIBRATION_PATH}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
