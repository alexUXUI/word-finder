/**
 * Pipeline as a first-class config-driven object.
 *
 * A pipeline is an ordered binding of role implementations. The runner
 * (`./runner.ts`) walks the graph, threading `RoleContext` through each
 * role, producing a `PipelineResult` and a `GenerationTrace`.
 *
 * See `docs/AI_ENGINEERING.md` §1 for the framing and §3 for the algorithms
 * each composition expresses.
 */

import type {
  PromptParserRole,
  StrategyRouterRole,
  CandidateGeneratorRole,
  MutatorRole,
  CriticRole,
  AggregatorRole,
  NarratorRole,
} from '../roles/types';

export interface MutationLoopConfig {
  /** Number of hill-climb iterations. Each iteration applies up to `k` swaps. */
  iterations: number;
  /** Swaps per iteration. Each is scored individually; best is kept. */
  swapsPerIteration: number;
  /**
   * If true, runner accepts mutations only if they improve `finalScore`. If
   * false, runner accepts all (random walk).
   */
  acceptOnlyImprovements?: boolean;
}

export interface PipelineRoles {
  promptParser: PromptParserRole;
  strategyRouter: StrategyRouterRole;
  candidateGenerator: CandidateGeneratorRole;
  /** Optional — if present, runner runs `iterations` hill-climb steps. */
  mutator?: MutatorRole;
  /** Optional — if absent, runner uses deterministic finalScore for ranking. */
  critic?: CriticRole;
  aggregator: AggregatorRole;
  narrator: NarratorRole;
}

export interface Pipeline {
  /** Stable id; used as the eval row key. */
  readonly id: string;
  /** Semver string. Bumped when role assignments / params change. */
  readonly version: string;
  /** Human-readable description; shown in the Lab. */
  readonly description: string;
  /** Bound role implementations. */
  readonly roles: PipelineRoles;
  /** Optional mutator-loop config; required when `roles.mutator` is set. */
  readonly mutationLoop?: MutationLoopConfig;
  /** Pipeline-level params for the strategy router (style→strategy table, etc). */
  readonly routerParams?: Readonly<Record<string, unknown>>;
}

/**
 * Stable hash of a pipeline's role assignment. Used as the join key for
 * eval results so we know whether two runs are comparable.
 */
export const pipelineHash = (p: Pipeline): string => {
  const sig = JSON.stringify({
    id: p.id,
    version: p.version,
    roles: {
      promptParser: p.roles.promptParser.id,
      strategyRouter: p.roles.strategyRouter.id,
      candidateGenerator: p.roles.candidateGenerator.id,
      mutator: p.roles.mutator?.id ?? null,
      critic: p.roles.critic?.id ?? null,
      aggregator: p.roles.aggregator.id,
      narrator: p.roles.narrator.id,
    },
    mutationLoop: p.mutationLoop ?? null,
  });
  // Tiny djb2 — good enough for log lines / dedupe in the leaderboard.
  let h = 5381;
  for (let i = 0; i < sig.length; i++) {
    h = ((h << 5) + h + sig.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};
