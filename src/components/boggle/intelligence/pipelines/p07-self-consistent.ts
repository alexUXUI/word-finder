import type { Pipeline } from '../pipeline/types';
import { noopPromptParser } from '../roles/prompt-parser/noop';
import { makeSelfConsistentRouter } from '../roles/strategy-router/self-consistent';
import { makeBestOfNGenerator } from '../roles/candidate-generator/best-of-n';
import { makeDeterministicCritic } from '../roles/critic/deterministic';
import { argmaxAggregator } from '../roles/aggregator/argmax';
import { slmNarrator } from '../roles/narrator/slm-narrator';

/**
 * p07-self-consistent — algorithm F.
 *
 * Strategy router runs 5 votes at T=0.7 and majority-votes. Drops in for
 * `p01-smart-router` when single-call variance is the bottleneck. Cheap
 * to add to any pipeline that already uses the SLM router.
 *
 * Bench question (vs `p01-smart-router`): does voting move strategy
 * choice in measurably better ways? Today's strategy registry is too
 * small for self-consistency to differ from single-shot — needs
 * algorithms B/G to register more strategies before this pays off.
 */
export const p07SelfConsistent: Pipeline = {
  id: 'p07-self-consistent',
  version: '1.0.0',
  description:
    "Self-consistency router: 5 votes at T=0.7, majority. Cheap variance reduction on top of p01.",
  roles: {
    promptParser: noopPromptParser,
    strategyRouter: makeSelfConsistentRouter({ votes: 5, temperature: 0.7 }),
    candidateGenerator: makeBestOfNGenerator({ samples: 75, maxMs: 5000 }),
    critic: makeDeterministicCritic(),
    aggregator: argmaxAggregator,
    narrator: slmNarrator,
  },
};
