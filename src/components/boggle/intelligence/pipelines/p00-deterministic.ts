import type { Pipeline } from '../pipeline/types';
import { noopPromptParser } from '../roles/prompt-parser/noop';
import { makeRuleBasedRouter } from '../roles/strategy-router/rule-based';
import { makeBestOfNGenerator } from '../roles/candidate-generator/best-of-n';
import { makeDeterministicCritic } from '../roles/critic/deterministic';
import { argmaxAggregator } from '../roles/aggregator/argmax';
import { noopNarrator } from '../roles/narrator/noop';

/**
 * p00-deterministic — control pipeline. No SLM at any role. Pure search +
 * deterministic scorer. The bench baseline every other pipeline must beat.
 *
 * Same flow as the legacy `randomBoard()` augmented with the search engine:
 * frequency-weighted random sample × N, score, take best, no narration.
 */
export const p00Deterministic: Pipeline = {
  id: 'p00-deterministic',
  version: '1.0.0',
  description:
    'Pure deterministic baseline. Frequency-weighted best-of-N + argmax. No model calls. Used as the bench control.',
  roles: {
    promptParser: noopPromptParser,
    strategyRouter: makeRuleBasedRouter({ default: 'frequency-weighted' }),
    candidateGenerator: makeBestOfNGenerator({ samples: 75, maxMs: 5000 }),
    critic: makeDeterministicCritic(),
    aggregator: argmaxAggregator,
    narrator: noopNarrator,
  },
};
