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

/**
 * Per-role model override. Pipelines that compose different models per
 * role (the "compositions of different models" target in
 * `AI_ENGINEERING.md` §4) populate this. The runner resolves each entry
 * via `getProviderForId(id)` and feeds the right provider to that role's
 * `RoleContext`.
 *
 * Roles whose key is absent fall back to the default `model` argument
 * passed into `runPipeline`. Roles that don't need a model (deterministic
 * implementations) ignore the entry.
 *
 * Example:
 *   roleModels: {
 *     'prompt-parser': 'smollm2-135m',     // tiny, fast NL→struct
 *     'mutator': 'qwen2.5-0.5b',           // mid-size, strong reasoner
 *     'critic': 'cloudflare-server',       // upstream, frees device
 *     'narrator': 'smollm2-360m',          // tiny is fine for one sentence
 *   }
 */
export type RoleModelOverrides = Partial<{
  'prompt-parser': string;
  'strategy-router': string;
  'candidate-generator': string;
  mutator: string;
  critic: string;
  aggregator: string;
  narrator: string;
}>;

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
  /**
   * Per-role model overrides. When set, the runner resolves the named SLM
   * via `getProviderForId(id)` (lazy + cached) and feeds it into that
   * role's `RoleContext`. Roles not listed here fall back to the default
   * `model` argument passed into `runPipeline`.
   */
  readonly roleModels?: RoleModelOverrides;
}

/**
 * Stable hash of a pipeline's role assignment. Used as the join key for
 * eval results so we know whether two runs are comparable. Includes the
 * roleModels assignment so a same-roles-different-models composition
 * gets a different hash.
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
    roleModels: p.roleModels ?? null,
  });
  // Tiny djb2 — good enough for log lines / dedupe in the leaderboard.
  let h = 5381;
  for (let i = 0; i < sig.length; i++) {
    h = ((h << 5) + h + sig.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};
