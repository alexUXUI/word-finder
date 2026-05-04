import type { Pipeline } from '../pipeline/types';
import { noopPromptParser } from '../roles/prompt-parser/noop';
import { makeRuleBasedRouter } from '../roles/strategy-router/rule-based';
import { makeEvolutionaryGenerator } from '../roles/candidate-generator/evolutionary';
import { slmSwapMutator } from '../roles/mutator/slm-swap';
import { makeDeterministicCritic } from '../roles/critic/deterministic';
import { argmaxAggregator } from '../roles/aggregator/argmax';
import { slmNarrator } from '../roles/narrator/slm-narrator';

/**
 * p03-evolutionary — algorithm B from `AI_ENGINEERING.md` §3.
 *
 * Population of 20 random-init boards. 8 generations: keep top-4
 * survivors (elitism), produce 8 children via SLM-as-crossover from
 * random parent pairs, mutate each child via slm-swap, score, sort,
 * truncate to population size. Return the final best.
 *
 * Bench questions:
 *   - vs `p02-slm-mutator` at matched compute: does evolutionary search
 *     dominate single-line hill-climb? (Theory: crossover lets two strong
 *     subgrids merge into a board the local-search couldn't find.)
 *   - vs `p02b-random-mutator`: does the SLM crossover beat random-only
 *     evolution at the same population/generation budget?
 */
export const p03Evolutionary: Pipeline = {
  id: 'p03-evolutionary',
  version: '1.0.0',
  description:
    'Evolutionary search with SLM crossover. Pop=20, 8 gens, 4 survivors, 8 children/gen, 2 mutations/child.',
  roles: {
    promptParser: noopPromptParser,
    strategyRouter: makeRuleBasedRouter({ default: 'frequency-weighted' }),
    candidateGenerator: makeEvolutionaryGenerator({
      populationSize: 20,
      generations: 8,
      survivors: 4,
      children: 8,
      mutator: slmSwapMutator,
      mutationsPerChild: 2,
      maxMs: 25_000,
    }),
    critic: makeDeterministicCritic(),
    aggregator: argmaxAggregator,
    narrator: slmNarrator,
  },
};
