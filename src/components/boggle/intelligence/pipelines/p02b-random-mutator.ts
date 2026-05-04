import type { Pipeline } from '../pipeline/types';
import { noopPromptParser } from '../roles/prompt-parser/noop';
import { makeRuleBasedRouter } from '../roles/strategy-router/rule-based';
import { makeBestOfNGenerator } from '../roles/candidate-generator/best-of-n';
import { randomSwapMutator } from '../roles/mutator/random-swap';
import { makeDeterministicCritic } from '../roles/critic/deterministic';
import { argmaxAggregator } from '../roles/aggregator/argmax';
import { noopNarrator } from '../roles/narrator/noop';

/**
 * p02b-random-mutator — control for `p02-slm-mutator`. Identical flow except
 * the mutator proposes random swaps instead of SLM-driven swaps. Lets the
 * bench answer the question that actually matters: are the SLM's English
 * priors *real* signal, or is hill-climb itself doing the work?
 *
 * If `p02b` matches or beats `p02` at meaningfully lower cost, the SLM
 * mutator is dead weight. If `p02` beats `p02b` outside the noise band,
 * algorithm A is real.
 */
export const p02bRandomMutator: Pipeline = {
  id: 'p02b-random-mutator',
  version: '1.0.0',
  description:
    'Control for p02. Random-swap hill-climb: same loop, no model. Tests whether hill-climb itself or the SLM is doing the work.',
  roles: {
    promptParser: noopPromptParser,
    strategyRouter: makeRuleBasedRouter({ default: 'frequency-weighted' }),
    candidateGenerator: makeBestOfNGenerator({ samples: 50, maxMs: 4000 }),
    mutator: randomSwapMutator,
    critic: makeDeterministicCritic(),
    aggregator: argmaxAggregator,
    narrator: noopNarrator,
  },
  mutationLoop: {
    iterations: 8,
    swapsPerIteration: 3,
    acceptOnlyImprovements: true,
  },
};
