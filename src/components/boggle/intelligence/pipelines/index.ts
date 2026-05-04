/**
 * All pipelines registered for the Lab and the bench.
 *
 * Adding a new pipeline = adding a TS file under this dir + importing it
 * here. The bench runner picks them all up automatically.
 */

import { registerPipeline, setChampion } from '../pipeline/registry';
import { p00Deterministic } from './p00-deterministic';
import { p01SmartRouter } from './p01-smart-router';
import { p02SlmMutator } from './p02-slm-mutator';
import { p02bRandomMutator } from './p02b-random-mutator';
import { p03Evolutionary } from './p03-evolutionary';
import { p04CriticRerank } from './p04-critic-rerank';
import { p05ParsedPromptMutator } from './p05-parsed-prompt-mutator';
import { p06Cascade } from './p06-cascade';
import { p07SelfConsistent } from './p07-self-consistent';

let initialized = false;

/**
 * Idempotent registration. Safe to call from multiple entry points
 * (player UI, bench script, dev tools).
 */
export const initializePipelines = (): void => {
  if (initialized) return;
  initialized = true;
  registerPipeline(p00Deterministic);
  registerPipeline(p01SmartRouter);
  registerPipeline(p02SlmMutator);
  registerPipeline(p02bRandomMutator);
  registerPipeline(p03Evolutionary);
  registerPipeline(p04CriticRerank);
  registerPipeline(p05ParsedPromptMutator);
  registerPipeline(p06Cascade);
  registerPipeline(p07SelfConsistent);
  // Default champion = p01 (current production behavior). Bench leaderboard
  // promotes a different one when it wins.
  setChampion('p01-smart-router');
};

export {
  p00Deterministic,
  p01SmartRouter,
  p02SlmMutator,
  p02bRandomMutator,
  p03Evolutionary,
  p04CriticRerank,
  p05ParsedPromptMutator,
  p06Cascade,
  p07SelfConsistent,
};
