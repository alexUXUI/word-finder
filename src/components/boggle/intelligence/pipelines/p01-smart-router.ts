import type { Pipeline } from '../pipeline/types';
import { noopPromptParser } from '../roles/prompt-parser/noop';
import { slmRouter } from '../roles/strategy-router/slm-router';
import { makeBestOfNGenerator } from '../roles/candidate-generator/best-of-n';
import { makeDeterministicCritic } from '../roles/critic/deterministic';
import { argmaxAggregator } from '../roles/aggregator/argmax';
import { slmNarrator } from '../roles/narrator/slm-narrator';

/**
 * p01-smart-router — today's "Smart Mode" expressed as a pipeline.
 *
 * SLM picks the strategy (with one strategy registered today, this is
 * effectively the rule-based router; the value will materialize when
 * algorithm B/G register more strategies). SLM narrates after the fact.
 * Search and scoring are deterministic.
 *
 * Bench question vs `p00-deterministic`: do the SLM steps add measurable
 * quality, or are they cosmetic? Today we expect ≈ tie on quality (router
 * has only one strategy to choose from), with `p01` paying token cost.
 * That's the *honest* signal — and it's why `p02-slm-mutator` is where the
 * model starts earning its keep.
 */
export const p01SmartRouter: Pipeline = {
  id: 'p01-smart-router',
  version: '1.0.0',
  description:
    "Today's Smart Mode: SLM strategy router + frequency-weighted best-of-N + deterministic scorer + SLM narrator.",
  roles: {
    promptParser: noopPromptParser,
    strategyRouter: slmRouter,
    candidateGenerator: makeBestOfNGenerator({ samples: 75, maxMs: 5000 }),
    critic: makeDeterministicCritic(),
    aggregator: argmaxAggregator,
    narrator: slmNarrator,
  },
};
