import type { Pipeline } from '../pipeline/types';
import { noopPromptParser } from '../roles/prompt-parser/noop';
import { makeRuleBasedRouter } from '../roles/strategy-router/rule-based';
import { makeBestOfNGenerator } from '../roles/candidate-generator/best-of-n';
import { slmJudgeCritic } from '../roles/critic/slm-judge';
import { argmaxAggregator } from '../roles/aggregator/argmax';
import { slmNarrator } from '../roles/narrator/slm-narrator';

/**
 * p04-critic-rerank — algorithm C from `AI_ENGINEERING.md` §3.
 *
 * Generator emits top-K candidates (best-of-N → top-K mode). SLM judge
 * rates each against the *goal description* on 0..1. Argmax aggregator
 * picks by critic rating instead of deterministic finalScore.
 *
 * The eval question: does the judge rating predict held-out player
 * satisfaction better than the scalar scorer? Subjective metrics like
 * "does this board feel like the request" only the judge can express.
 *
 * Calibration is gated separately. Until the judge agrees with humans on
 * the player-rated set, its `goalAdherence` is reported but doesn't gate
 * promotions. See `EVAL_SUITE.md` §calibration.
 */
export const p04CriticRerank: Pipeline = {
  id: 'p04-critic-rerank',
  version: '1.0.0',
  description:
    'Verifier–generator: best-of-50 → top-10 by score → SLM judge rerank → argmax(critic) → narrate.',
  roles: {
    promptParser: noopPromptParser,
    strategyRouter: makeRuleBasedRouter({ default: 'frequency-weighted' }),
    candidateGenerator: makeBestOfNGenerator({
      samples: 50,
      maxMs: 4000,
      returnTopK: 10,
    }),
    critic: slmJudgeCritic,
    aggregator: argmaxAggregator,
    narrator: slmNarrator,
  },
};
