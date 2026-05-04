/**
 * Run the same pipeline N times in sequence on the same goal, return all
 * results. The default Smart Mode flow uses this with N=10 so the player
 * gets a "best of 10" with full per-run statistics for the dashboard.
 *
 * Independent runs, not retry-to-floor — every run starts from a fresh
 * random seed and explores the search space. The picker (`pickBest`)
 * chooses by `criticScore` if a critic ran, else `finalScore`.
 *
 * Live progress: `onRunComplete(result, idx, allSoFar)` fires after each
 * run so the UI can render the dashboard incrementally.
 */

import { runPipeline } from './runner';
import type { Pipeline } from './types';
import type { PipelineRunInput } from './runner';
import type { PipelineResult } from '../roles/types';

export interface BatchRunOptions {
  /** Number of independent end-to-end pipeline runs. */
  runs: number;
  /** Fired after each run. `allSoFar` is the running list (does not mutate). */
  onRunComplete?: (
    result: PipelineResult,
    idx: number,
    allSoFar: readonly PipelineResult[]
  ) => void;
  /** Cancellation. The current in-flight run still finishes. */
  signal?: AbortSignal;
  /** Hard wall-clock cap across the batch. Default: no cap. */
  maxMs?: number;
}

export const runPipelineBatch = async (
  pipeline: Pipeline,
  input: PipelineRunInput,
  opts: BatchRunOptions
): Promise<PipelineResult[]> => {
  const out: PipelineResult[] = [];
  const t0 = performance.now();
  for (let i = 0; i < opts.runs; i++) {
    if (opts.signal?.aborted) break;
    if (opts.maxMs && performance.now() - t0 > opts.maxMs) break;
    // Re-run the full pipeline. Each call generates a fresh trace, fresh
    // random samples, fresh model calls. They're independent samples.
    const r = await runPipeline(pipeline, input);
    out.push(r);
    opts.onRunComplete?.(r, i, out);
  }
  return out;
};

/**
 * Pick the winner from a batch by the most player-relevant signal:
 * critic rating if available, else finalScore. Ties broken by
 * playerRelevantWords, then by lower elapsedMs (faster preferred at
 * equal quality).
 */
export const pickBest = (results: readonly PipelineResult[]): PipelineResult => {
  if (results.length === 0) {
    throw new Error('pickBest: empty results');
  }
  let best = results[0];
  const score = (r: PipelineResult): number =>
    r.criticScore !== undefined ? r.criticScore : r.score.finalScore;
  for (const r of results.slice(1)) {
    const sb = score(best);
    const sr = score(r);
    if (sr > sb) {
      best = r;
      continue;
    }
    if (sr === sb) {
      if (r.score.playerRelevantWords > best.score.playerRelevantWords) {
        best = r;
        continue;
      }
      if (
        r.score.playerRelevantWords === best.score.playerRelevantWords &&
        r.elapsedMs < best.elapsedMs
      ) {
        best = r;
      }
    }
  }
  return best;
};

/**
 * Summary statistics across a batch — fed into the dashboard header.
 */
export interface BatchStats {
  n: number;
  /** mean / min / max / std of playerRelevantWords */
  playerWords: { mean: number; min: number; max: number; std: number };
  /** mean of finalScore */
  finalScore: { mean: number; min: number; max: number; std: number };
  /** total elapsed across all runs (sum) */
  totalElapsedMs: number;
  /** count of runs that hit the floor */
  floorMetCount: number;
  /** index (0-based) of best run */
  bestIdx: number;
}

export const summarizeBatch = (
  results: readonly PipelineResult[]
): BatchStats => {
  const n = results.length;
  const empty: BatchStats = {
    n: 0,
    playerWords: { mean: 0, min: 0, max: 0, std: 0 },
    finalScore: { mean: 0, min: 0, max: 0, std: 0 },
    totalElapsedMs: 0,
    floorMetCount: 0,
    bestIdx: -1,
  };
  if (n === 0) return empty;

  const pw = results.map((r) => r.score.playerRelevantWords);
  const fs = results.map((r) => r.score.finalScore);
  const stat = (xs: number[]): { mean: number; min: number; max: number; std: number } => {
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    const variance =
      xs.length > 1
        ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1)
        : 0;
    return { mean, min, max, std: Math.sqrt(variance) };
  };
  const best = pickBest(results);
  const bestIdx = results.indexOf(best);
  return {
    n,
    playerWords: stat(pw),
    finalScore: stat(fs),
    totalElapsedMs: results.reduce((a, r) => a + r.elapsedMs, 0),
    floorMetCount: results.filter((r) => r.floorMet).length,
    bestIdx,
  };
};
