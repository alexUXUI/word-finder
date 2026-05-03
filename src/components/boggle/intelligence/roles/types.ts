/**
 * Role interfaces for the AI engineering substrate.
 *
 * A role is a typed step in the board-generation pipeline. Implementations
 * live in `roles/<role-name>/<impl>.ts`. A `Pipeline` (see `../pipeline/types.ts`)
 * is a config that binds one implementation per role.
 *
 * See `docs/AI_ENGINEERING.md` §2 for the role table and §3 for the algorithms
 * each composition expresses.
 */

import type { LanguageType } from '../../models';
import type {
  BoardScore,
  ScoreWeights,
} from '../../generation/scorer';
import type { LocalModelProvider } from '../local-model/types';
import type { Tracer, GenerationTrace } from '../../generation/trace';

/* ──────────────────────────────────────────────────────────────────
 * Shared value types
 * ────────────────────────────────────────────────────────────────── */

/**
 * Player-facing intent. Roles read this; CandidateGenerator/Mutator/Critic
 * may also read pipeline-level params for tuning knobs.
 */
export interface BoardGenerationGoal {
  size: number;
  minWordLength: number;
  language: LanguageType;
  minPlayerRelevantWords?: number;
  maxAttempts?: number;
  style?:
    | 'balanced'
    | 'long-word-heavy'
    | 'classic'
    | 'rare-letter'
    | 'chaotic';
  difficulty?: 'easy' | 'medium' | 'hard';
  novelty?: 'low' | 'medium' | 'high';
  requiredLetters?: readonly string[];
  preferredLetters?: readonly string[];
  avoidedLetters?: readonly string[];
  themedSuffixes?: readonly string[];
  /** Free-form NL prompt. Visible to PromptParser, StrategyRouter, Narrator. */
  description?: string;
}

/** Output of `CandidateGenerator` and intermediate state through Mutator/Critic. */
export interface ScoredBoard {
  board: string;
  score: BoardScore;
  /** Solver output for this board (handy for downstream roles). */
  words: readonly string[];
  /** Provenance — which strategy / mutator produced this board. */
  source: string;
}

/** Mutator output: a swap proposal with optional rationale. */
export interface SwapProposal {
  /** 0-indexed cell positions in the flat board string. */
  i: number;
  j: number;
  /** Optional rationale (SLM proposers populate this; random does not). */
  rationale?: string;
}

/** Final output of a pipeline run. */
export interface PipelineResult {
  board: string;
  score: BoardScore;
  words: readonly string[];
  /** Strategy id that the StrategyRouter chose. */
  strategy: string;
  /** Narration produced by the Narrator role. May be empty for noop. */
  explanation: string;
  /** Diagnostic stats. */
  modelCalls: number;
  candidatesEvaluated: number;
  /** Number of mutator iterations actually applied. */
  mutationsApplied: number;
  elapsedMs: number;
  /** True if `goal.minPlayerRelevantWords` was met (or no floor set). */
  floorMet: boolean;
  /** Generation trace produced by the pipeline. */
  trace?: GenerationTrace;
  /** Critic rating for the winning board, if a non-deterministic critic ran. */
  criticScore?: number;
}

/* ──────────────────────────────────────────────────────────────────
 * Shared infrastructure threaded into every role
 * ────────────────────────────────────────────────────────────────── */

/**
 * Per-pipeline-run context. Roles don't see the whole pipeline — they get a
 * scoped subset of plumbing (trace handle, model, callbacks).
 */
export interface RoleContext {
  trace: Tracer;
  /** Currently-active span id; roles may open child spans on it. */
  parentSpanId?: string;
  /** SLM provider when the role's implementation needs one. */
  model?: LocalModelProvider;
  /** Dictionary for solving / scoring. */
  dictionary: readonly string[];
  /** Lifecycle/UX callbacks. Roles may call `narrate` and `tokenStream`. */
  narrate?: (line: string) => void;
  tokenStream?: (chunk: string, accumulator: string) => void;
  /** Search progress: optional, fires per candidate evaluation. */
  searchProgress?: (info: {
    index: number;
    total: number;
    bestScore: number;
    playerRelevantWords: number;
  }) => void;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Scoring weights resolved by the runner (style → weights). */
  scoreWeights: Readonly<ScoreWeights>;
}

/* ──────────────────────────────────────────────────────────────────
 * Role interfaces
 * ────────────────────────────────────────────────────────────────── */

export interface PromptParserRole {
  readonly id: string;
  readonly kind: 'prompt-parser';
  /**
   * Returns a possibly-modified `BoardGenerationGoal`. Implementations may
   * read `goal.description` and populate structured fields (style,
   * requiredLetters, etc).
   */
  parse(goal: BoardGenerationGoal, ctx: RoleContext): Promise<BoardGenerationGoal>;
}

export interface StrategyRouterRole {
  readonly id: string;
  readonly kind: 'strategy-router';
  /**
   * Returns the strategy id the CandidateGenerator should use. Must be a name
   * registered in `generation/registry`.
   */
  route(goal: BoardGenerationGoal, available: readonly string[], ctx: RoleContext): Promise<string>;
}

export interface CandidateGeneratorRole {
  readonly id: string;
  readonly kind: 'candidate-generator';
  /**
   * Produces an initial set of scored candidates. Implementations may consume
   * a seed board (for hill-climb / evolutionary continuations).
   */
  generate(args: {
    goal: BoardGenerationGoal;
    strategyId: string;
    seedBoard?: string;
    ctx: RoleContext;
  }): Promise<readonly ScoredBoard[]>;
}

export interface MutatorRole {
  readonly id: string;
  readonly kind: 'mutator';
  /**
   * Given a current board (and its score / goal), propose K swap operations.
   * Return at most `k` distinct proposals; runner applies them and re-scores.
   */
  proposeSwaps(args: {
    board: ScoredBoard;
    goal: BoardGenerationGoal;
    k: number;
    ctx: RoleContext;
  }): Promise<readonly SwapProposal[]>;
}

export interface CriticRole {
  readonly id: string;
  readonly kind: 'critic';
  /**
   * Returns a quality rating in [0,1] for board-vs-goal.
   * Deterministic implementations (default scorer) compress finalScore;
   * SLM-judge implementations rate goal-fit subjectively.
   */
  rate(args: {
    board: ScoredBoard;
    goal: BoardGenerationGoal;
    ctx: RoleContext;
  }): Promise<number>;
}

export interface AggregatorRole {
  readonly id: string;
  readonly kind: 'aggregator';
  /**
   * Pick the winner from a candidate pool. May read critic ratings via the
   * `critic` field on each candidate when present.
   */
  pick(args: {
    candidates: readonly ScoredBoardWithCritic[];
    goal: BoardGenerationGoal;
    ctx: RoleContext;
  }): Promise<ScoredBoardWithCritic>;
}

export interface NarratorRole {
  readonly id: string;
  readonly kind: 'narrator';
  /**
   * Produce the player-facing one-sentence explanation for the chosen board.
   * Must NEVER spoil a word — see `EXPLAIN_SYSTEM` contract in
   * `prompts/narrator.ts`.
   */
  narrate(args: {
    chosen: ScoredBoardWithCritic;
    goal: BoardGenerationGoal;
    ctx: RoleContext;
  }): Promise<string>;
}

/** Aggregator input: candidate plus optional critic rating. */
export interface ScoredBoardWithCritic extends ScoredBoard {
  critic?: number;
}

export type Role =
  | PromptParserRole
  | StrategyRouterRole
  | CandidateGeneratorRole
  | MutatorRole
  | CriticRole
  | AggregatorRole
  | NarratorRole;

export type RoleKind = Role['kind'];
