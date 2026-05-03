import type { BoardScore, ScoreWeights } from '../../generation/scorer';
import type { LocalModelProvider } from '../local-model/types';
import type {
  GenerationTrace,
  Tracer,
} from '../../generation/trace';

export interface BoardGenerationGoal {
  size: number;
  minWordLength: number;
  /**
   * Hard floor on player-relevant word count. The orchestrator retries
   * the search until this is met (or maxAttempts is exhausted, in which
   * case it returns the best attempt). Default: undefined (no floor).
   */
  minPlayerRelevantWords?: number;
  /** Maximum attempts to satisfy minPlayerRelevantWords. Default: 3. */
  maxAttempts?: number;
  /** Optional broad style hint. */
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
  /** Free-form natural-language description. SLM uses this if present. */
  description?: string;
}

export interface OrchestratorBudget {
  /** Cap on the total number of LLM calls per generation. Default 4. */
  maxModelCalls?: number;
  /** Cap on candidates the search engine is allowed to evaluate. Default 75. */
  maxCandidates?: number;
  /** Cap on search wall-clock (ms). Default 5000. */
  maxSearchMs?: number;
}

export interface ToolRegistry {
  /** Names a strategy must match for the SLM's pick to be accepted. */
  readonly availableStrategies: readonly string[];
  /**
   * Constraint to override default scoring per goal style. Returned weights
   * are merged into ScoreWeights.
   */
  weightsForStyle?(style: BoardGenerationGoal['style']): Partial<ScoreWeights>;
}

export interface OrchestratorCallbacks {
  /**
   * Step-level narration. Fires once per major event with a short
   * human-readable line (e.g. "🤔 Asking model which strategy to use").
   */
  onNarrate?: (line: string) => void;
  /**
   * Per-token streaming during model calls. Fires repeatedly with
   * (chunk, accumulator) — chunk is the new text since the last call;
   * accumulator is the full text so far for the current model step.
   */
  onTokenStream?: (chunk: string, accumulator: string) => void;
  /**
   * Search progress callback. Fires after each candidate evaluation
   * with running counts and best score so far.
   */
  onSearchProgress?: (info: {
    index: number;
    total: number;
    bestScore: number;
    playerRelevantWords: number;
  }) => void;
}

export interface OrchestratorConfig {
  model: LocalModelProvider;
  tracer: Tracer;
  tools: ToolRegistry;
  budget?: OrchestratorBudget;
  callbacks?: OrchestratorCallbacks;
}

export interface OrchestratorResult {
  board: string;
  score: BoardScore;
  words: string[];
  strategyChosen: string;
  explanation: string;
  modelCalls: number;
  elapsedMs: number;
  trace: GenerationTrace;
  /** True if the result's playerRelevantWords met goal.minPlayerRelevantWords. */
  floorMet: boolean;
  /** Number of search attempts made (for diagnostics). */
  attemptsMade: number;
  /** Total candidates evaluated across all attempts (for "best of K" UI). */
  totalCandidatesEvaluated: number;
}
