import type { Pipeline } from '../pipeline/types';
import { noopPromptParser } from '../roles/prompt-parser/noop';
import { makeRuleBasedRouter } from '../roles/strategy-router/rule-based';
import { makeBestOfNGenerator } from '../roles/candidate-generator/best-of-n';
import { slmSwapMutator } from '../roles/mutator/slm-swap';
import { makeDeterministicCritic } from '../roles/critic/deterministic';
import { argmaxAggregator } from '../roles/aggregator/argmax';
import { slmNarrator } from '../roles/narrator/slm-narrator';

/**
 * p02-slm-mutator — algorithm A from `AI_ENGINEERING.md` §3.
 *
 * Sample N candidates → take the best → SLM-mutated hill climb (8 iters ×
 * 3 swap proposals each) → narrate.
 *
 * This is where the model starts earning its keep: random hill-climb works
 * but converges slowly because uniform-random swaps know nothing about
 * Boggle adjacency or English priors. The SLM-as-mutator encodes both.
 *
 * Bench question vs `p01-smart-router`: does the SLM-driven hill-climb
 * dominate plain best-of-N at matched compute? The honest answer is whatever
 * `yarn bench --champion=p01 --challenger=p02` says.
 */
export const p02SlmMutator: Pipeline = {
  id: 'p02-slm-mutator',
  version: '1.0.0',
  description:
    'SLM-mutated hill-climb. Random sample (50) → SLM proposes 3 swaps × 8 iters → keep improvements → narrate.',
  roles: {
    promptParser: noopPromptParser,
    strategyRouter: makeRuleBasedRouter({ default: 'frequency-weighted' }),
    candidateGenerator: makeBestOfNGenerator({ samples: 50, maxMs: 4000 }),
    mutator: slmSwapMutator,
    critic: makeDeterministicCritic(),
    aggregator: argmaxAggregator,
    narrator: slmNarrator,
  },
  mutationLoop: {
    iterations: 8,
    swapsPerIteration: 3,
    acceptOnlyImprovements: true,
  },
};
