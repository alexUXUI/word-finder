import type { Pipeline } from '../pipeline/types';
import { slmPromptParser } from '../roles/prompt-parser/slm-parser';
import { slmRouter } from '../roles/strategy-router/slm-router';
import { makeBestOfNGenerator } from '../roles/candidate-generator/best-of-n';
import { slmSwapMutator } from '../roles/mutator/slm-swap';
import { makeDeterministicCritic } from '../roles/critic/deterministic';
import { argmaxAggregator } from '../roles/aggregator/argmax';
import { slmNarrator } from '../roles/narrator/slm-narrator';

/**
 * p05-parsed-prompt-mutator — algorithm G + algorithm A combined.
 *
 * Player's free-form prompt is parsed into structured fields BEFORE the
 * strategy router sees it. Then the SLM-mutator hill-climb runs as in
 * `p02-slm-mutator`. This is what makes the Lab prompt actually
 * functional — the parsed `style`, `requiredLetters`, `themedSuffixes`
 * thread through the rest of the pipeline as real signal.
 *
 * Bench questions:
 *   1. (vs `p02-slm-mutator`) Does parsing the prompt produce boards the
 *      SLM judge rates as better-fit-to-prompt?
 *   2. (parser F1 vs ground truth in `evals/prompts.yaml`) Does the
 *      parser produce structured fields that match human-labeled truth?
 */
export const p05ParsedPromptMutator: Pipeline = {
  id: 'p05-parsed-prompt-mutator',
  version: '1.0.0',
  description:
    'SLM parses prompt → structured goal → SLM router → SLM-mutated hill climb → narrate.',
  roles: {
    promptParser: slmPromptParser,
    strategyRouter: slmRouter,
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
