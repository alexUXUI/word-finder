/**
 * Lab UI state. Replaces the old BuilderState — strict superset of features
 * (still has prompt, run-batch, saved boards) plus pipeline cards, side-by-
 * side bench, and champion indicator.
 */

export interface BatchRow {
  id: string;
  pipelineId: string;
  board: string;
  finalScore: number;
  playerRelevantWords: number;
  maxWordLength: number;
  strategy: string;
  elapsedMs: number;
  candidatesEvaluated: number;
  mutationsApplied: number;
  modelCalls: number;
  explanation: string;
  floorMet: boolean;
  createdAt: string;
}

export interface SavedBoard {
  id: string;
  pipelineId: string;
  board: string;
  finalScore: number;
  playerRelevantWords: number;
  note: string;
  isFavorite: boolean;
  savedAt: string;
}

/** Compact leaderboard summary for pipeline cards. */
export interface PipelineCardScores {
  pipelineId: string;
  // From the most recent bench row, by goal:
  perGoal: Record<
    string,
    {
      mean: number;
      p10: number;
      p90: number;
      runs: number;
      elapsedMs: number;
    }
  >;
  paretoFrontier?: boolean;
}

export interface BenchPair {
  championId: string;
  challengerId: string;
  goalId: string;
  runs: number;
  championResults: BatchRow[];
  challengerResults: BatchRow[];
  isRunning: boolean;
  cancelRequested: boolean;
  completed: number;
  total: number;
}

export type LabTab = 'pipelines' | 'bench' | 'saved';

export interface LabState {
  open: boolean;
  tab: LabTab;
  prompt: string;
  selectedPipelineId: string;
  bench: BenchPair | null;
  savedBoards: SavedBoard[];
  cardScores: PipelineCardScores[];
  /** Mirror of registry.getChampionId() for UI display. Synced on render. */
  championId: string | null;
}
