import { createContext } from '@builder.io/qwik';
import type { NoSerialize, Signal } from '@builder.io/qwik';
import type {
  BoardState,
  DictionaryState,
  GameState,
  AnswersState,
  WebWorkerState,
} from './models';

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
