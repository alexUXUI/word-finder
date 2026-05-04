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
import type { MultiplayerClient, ConnectionStatus } from './multiplayer/client';
import type { GameState as MpGameState, ResultsPayload } from './multiplayer/protocol';
import type { PlayerProfileState } from './profile/types';

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
  /** True when the side-panel dashboard is open. */
  dashboardOpen?: boolean;
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
  /** Cross-chart linking on the BatchDashboard. Index is BatchRunRow.idx
   *  (the original run number, not the sorted-table position). */
  hoveredRunIdx?: number | null;
  selectedRunIdx?: number | null;
}

export const SmartCtx = createContext<SmartState>('smart-context');
export const BuilderCtx = createContext<BuilderState>('builder-context');

// ─────────────────────────── Multiplayer ───────────────────────────

export interface MultiplayerEventEntry {
  /** Auto-incremented for keying. */
  id: number;
  /** Lower-cased event kind for styling/filtering. */
  kind: 'joined' | 'left' | 'found' | 'started' | 'ended' | 'error';
  /** Display string shown in the recent-events feed. */
  text: string;
  /** Origin player when relevant — used to color the row. */
  playerId?: string;
  ts: number;
}

export interface MultiplayerState {
  /** True once the user has explicitly opened the panel at least once. */
  panelOpen: boolean;
  /** Persistent UUID from localStorage. Empty until hydrated. */
  playerId: string;
  /** Editable display name; persisted to localStorage on commit. */
  displayName: string;
  /** Form state — game name being typed in JoinForm. */
  pendingGameName: string;
  /** Server-mirror of the canonical room state. Null until joined. */
  game: MpGameState | null;
  connectionStatus: ConnectionStatus;
  /** Most recent server error message — surfaced in the panel for one beat. */
  lastError: string | null;
  /** Last 10 server events shown in the recent-activity feed. */
  recentEvents: MultiplayerEventEntry[];
  /** Captured payload from the most-recent `game_ended` frame, retained
   *  through the 'ended' panel state so the breakdown survives state changes. */
  lastResults: ResultsPayload | null;
  /** Most recently used game names (newest first). Surfaced in JoinForm. */
  recentGames: string[];
  /** Set once the user has started a game in this session — used by
   *  BoggleRoot to know whether to swap the local board back when the
   *  multiplayer game ends or the user leaves. */
  hasSwappedBoard: boolean;
  /** noSerialize'd refs — kept on the store so they survive between renders
   *  without serializing into the SSR HTML. */
  refs: {
    client?: NoSerialize<MultiplayerClient>;
    /** Snapshot of the local single-player board to restore after game end. */
    savedBoardChars?: NoSerialize<string[]>;
    savedBoardSize?: number;
    /** Live signal the panel can write to bump the "found-word counter" UI
     *  separate from server state, used for short-lived flash animations. */
    flashTickSignal?: Signal<number>;
  };
}

export const MultiplayerCtx = createContext<MultiplayerState>('multiplayer-context');

// ─────────────────────────── Profile ───────────────────────────

export type ProfileLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ProfileState {
  /** Persistent UUID — same source as MultiplayerState.playerId. Empty until hydrated. */
  playerId: string;
  /** Authoritative profile snapshot fetched from the PlayerProfile DO. */
  profile: PlayerProfileState | null;
  loadStatus: ProfileLoadStatus;
  loadError: string | null;
  /** True while a mutation (e.g. add-favorite) is in flight; UI can show a small spinner. */
  pendingMutation: boolean;
  /** True when the user has the avatar dropdown open in the top nav. */
  avatarMenuOpen: boolean;
}

export const ProfileCtx = createContext<ProfileState>('profile-context');

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
