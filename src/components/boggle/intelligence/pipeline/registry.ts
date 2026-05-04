/**
 * Pipeline registry — keeps the registered pipelines and tracks which one is
 * the current production champion. Consumed by `Controls.tsx` (player UI runs
 * the champion) and `evals/run-bench.ts` (benches all registered).
 *
 * The champion is a soft-state hint here; promotion is enforced by CI on a
 * leaderboard delta (see `EVAL_SUITE.md` §promotion). Production deployments
 * pin a champion via build flag.
 */

import type { Pipeline } from './types';

const REGISTRY = new Map<string, Pipeline>();
let CHAMPION_ID: string | null = null;

export const registerPipeline = (pipeline: Pipeline): void => {
  REGISTRY.set(pipeline.id, pipeline);
};

export const listPipelines = (): readonly Pipeline[] => {
  return [...REGISTRY.values()].sort((a, b) => a.id.localeCompare(b.id));
};

export const getPipeline = (id: string): Pipeline | undefined => {
  return REGISTRY.get(id);
};

export const setChampion = (id: string): void => {
  if (!REGISTRY.has(id)) {
    throw new Error(`cannot set champion: pipeline "${id}" is not registered`);
  }
  CHAMPION_ID = id;
};

export const getChampionId = (): string | null => CHAMPION_ID;

export const getChampion = (): Pipeline | null => {
  if (!CHAMPION_ID) return null;
  return REGISTRY.get(CHAMPION_ID) ?? null;
};
