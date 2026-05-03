import type { BoardScore, ScoreWeights } from '../../generation/scorer';
import type { LocalModelProvider } from '../local-model/types';
import type {
  GenerationTrace,
  Tracer,
} from '../../generation/trace';

export interface BoardGenerationGoal {
  size: number;
  minWordLength: number;
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

export interface OrchestratorConfig {
  model: LocalModelProvider;
  tracer: Tracer;
  tools: ToolRegistry;
  budget?: OrchestratorBudget;
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
}
