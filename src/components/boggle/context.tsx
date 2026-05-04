import { createContext } from '@builder.io/qwik';
import type { NoSerialize, Signal } from '@builder.io/qwik';
import type {
  BoardState,
  DictionaryState,
  GameState,
  AnswersState,
  WebWorkerState,
} from './models';
import type { BuilderState } from './builder/types';

export type { BuilderState };

export const BoardCtx = createContext<BoardState>('board-context');
export const DictionaryCtx = createContext<DictionaryState>('dictionary');
export const GameCtx = createContext<GameState>('game-context');
export const AnswersCtx = createContext<AnswersState>('answers-context');
export const WorkerCtx = createContext<WebWorkerState>('worker-context');

export type SmartModelStatus = 'idle' | 'loading' | 'ready' | 'error';
export type SmartGenerationStatus = 'idle' | 'running' | 'complete' | 'error';

export interface SmartState {
  enabled: boolean;
  modelStatus: SmartModelStatus;
  modelLoadProgress: number;
  modelLoadError?: string;
  /** Which model tier was picked for this device. Open string id; matches SLM_REGISTRY entries. */
  slmTier?: {
    id: string;
    modelId: string;
    approxSizeMb: number;
    displayName: string;
    reason: string;
  };
  generationStatus: SmartGenerationStatus;
  generationStage?: string;
  /** Per-generation narration log — populated by orchestrator callbacks. */
  narration: string[];
  /** Currently-streaming model output (replaces on every new model call). */
  liveTokens: string;
  /** Search progress: {evaluated, total, bestScore}. */
  searchProgress?: {
    index: number;
    total: number;
    bestScore: number;
    playerRelevantWords: number;
  };
  lastExplanation?: string;
  lastStrategy?: string;
  lastFinalScore?: number;
  lastModelCalls?: number;
  lastElapsedMs?: number;
  /** True if the orchestrator hit the requested floor. False = honest fail. */
  lastFloorMet?: boolean;
  /** Number of search attempts the orchestrator ran. */
  lastAttempts?: number;
  /** The minWordsPerBoard floor that was active for the last generation. */
  lastFloorTarget?: number;
  /** Player-relevant words on the last generated board. */
  lastPlayerRelevantWords?: number;
  /** Total boards searched across all attempts ("best of K"). */
  lastTotalCandidates?: number;
  /** Per-run dashboard rows from the last batch of pipeline runs. */
  lastBatch?: BatchRunRow[];
  /** Live progress while a batch is running. */
  batchProgress?: {
    completed: number;
    total: number;
    bestSoFar: number; // playerRelevantWords
  };
  /** True once the player has dismissed the current explanation banner. Reset on each new generation. */
  bannerDismissed: boolean;
  /** Holds noSerialize'd refs to SLM provider + MLflow tracer. */
  refs: {
    provider?: NoSerialize<unknown>;
    tracer?: NoSerialize<unknown>;
  };
  /** Function the search side calls when orchestrator finishes (or errors). */
  onResult?: NoSerialize<
    (result: { board: string; explanation: string; strategy: string; score: number; modelCalls: number; elapsedMs: number } | { error: string }) => void
  >;
  /** Pending board override — main thread sets this to swap in an orchestrator board after generation. */
  pendingBoardOverride?: Signal<string | null>;
}

export const SmartCtx = createContext<SmartState>('smart-context');
export const BuilderCtx = createContext<BuilderState>('builder-context');

/**
 * Per-run row in the multi-run dashboard. Serializable subset of
 * `PipelineResult` plus the run index. Lives in `SmartState.lastBatch`
 * after a Smart Mode reset so the dashboard can render charts + table.
 */
export interface BatchRunRow {
  /** 0-based run index in the batch. */
  idx: number;
  pipelineId: string;
  board: string;
  finalScore: number;
  playerRelevantWords: number;
  maxWordLength: number;
  averageWordLength: number;
  vowelRatio: number;
  letterEntropy: number;
  prefixDiversity: number;
  strategy: string;
  candidatesEvaluated: number;
  mutationsApplied: number;
  modelCalls: number;
  elapsedMs: number;
  floorMet: boolean;
  /** Critic rating in [0,1] when a non-deterministic critic ran; undefined otherwise. */
  criticScore?: number;
  explanation: string;
}
