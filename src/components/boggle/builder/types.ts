/**
 * Board Builder — design surface for power users / playtesters.
 *
 * Drives the orchestrator with a player-supplied prompt + run count and
 * collects results (BatchResult). Results can be loaded back into the
 * main game with a click, or saved (SavedBoard) for later reload.
 *
 * State persists to localStorage keyed by "word-finder.builder.*".
 */

export interface BatchResult {
  /** uuid-ish; stable for a row's lifetime in the table. */
  id: string;
  board: string;
  finalScore: number;
  playerRelevantWords: number;
  maxWordLength: number;
  strategy: string;
  elapsedMs: number;
  totalCandidatesEvaluated: number;
  explanation: string;
  floorMet: boolean;
  createdAt: string; // ISO
}

export interface SavedBoard {
  id: string;
  board: string;
  finalScore: number;
  playerRelevantWords: number;
  /** Player-written note. Empty string by default. */
  note: string;
  isFavorite: boolean;
  savedAt: string; // ISO
}

export interface BuilderState {
  open: boolean;
  /** Free-form prompt; written into goal.description on each run. */
  prompt: string;
  /** Currently running a batch. */
  isRunning: boolean;
  /** Set to true to cancel the in-flight batch at the next yield point. */
  cancelRequested: boolean;
  /** How many runs have completed in the current batch (UI progress). */
  runsCompleted: number;
  /** Total runs in the current batch. */
  runsTotal: number;
  /** Results from the most recent batch. Cleared at the start of a new one. */
  batchResults: BatchResult[];
  /** Persistent list of starred boards. */
  savedBoards: SavedBoard[];
}
