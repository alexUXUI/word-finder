import type { Pipeline } from '../pipeline/types';
import { noopPromptParser } from '../roles/prompt-parser/noop';
import { makeCascadeRouter } from '../roles/strategy-router/cascade';
import { makeBestOfNGenerator } from '../roles/candidate-generator/best-of-n';
import { makeDeterministicCritic } from '../roles/critic/deterministic';
import { argmaxAggregator } from '../roles/aggregator/argmax';
import { slmNarrator } from '../roles/narrator/slm-narrator';

/**
 * p06-cascade — algorithm E + a composition of different models.
 *
 * Strategy router cascades through SmolLM2-135M (110 MB, ~200ms)
 * → SmolLM2-360M (220 MB) → Qwen2.5-0.5B (786 MB). Each tier is queried
 * only when the previous one was unconfident. Narrator runs on the cheap
 * 360M because one sentence doesn't need the bigger model.
 *
 * This is the FIRST pipeline that actively composes different models
 * across roles.
 *
 * Bench questions:
 *   - vs p01-smart-router (Qwen-only on default tier): does the cascade
 *     match quality at lower cost? Today the strategy registry has only
 *     one English strategy so the router decision is trivial — once
 *     algorithms B/C add more strategies the cascade will have real work.
 *   - vs p07-self-consistent (5×Qwen vote): cheaper, similar variance?
 */
export const p06Cascade: Pipeline = {
  id: 'p06-cascade',
  version: '1.0.0',
  description:
    'Cascade router (135M → 360M → 0.5B) + tiny narrator (360M). Composition of different models.',
  roles: {
    promptParser: noopPromptParser,
    strategyRouter: makeCascadeRouter({
      ladder: ['smollm2-135m', 'smollm2-360m', 'qwen2.5-0.5b'],
      escalateOnFallback: true,
    }),
    candidateGenerator: makeBestOfNGenerator({ samples: 75, maxMs: 5000 }),
    critic: makeDeterministicCritic(),
    aggregator: argmaxAggregator,
    narrator: slmNarrator,
  },
  // Narrator uses the cheap tiny model — one sentence doesn't justify Qwen.
  // The cascade router manages its own ladder above.
  roleModels: {
    narrator: 'smollm2-360m',
  },
};
