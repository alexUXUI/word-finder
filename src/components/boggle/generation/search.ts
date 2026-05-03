import { buildTrie } from '../logic/trie';
import { solveWithTrie } from '../logic/boggle';
import type { LanguageType } from '../models';
import { defaultStrategyForLanguage } from './registry';
import type { BoardStrategy } from './types';
import { scoreBoard } from './scorer';
import type { BoardScore, ScoreWeights } from './scorer';

export interface RecentBoardForSimilarity {
  board: string;
  playerRelevantWords: readonly string[];
}

export interface SearchConfig {
  size: number;
  language: LanguageType;
  minWordLength: number;
  dictionary: readonly string[];
  strategy?: BoardStrategy;
  maxCandidates?: number;
  maxMs?: number;
  /** Stop early if a candidate's finalScore reaches this. */
  targetScore?: number;
  recentBoards?: readonly RecentBoardForSimilarity[];
  scoreWeights?: Partial<ScoreWeights>;
  /** Optional: pre-built trie. Caller responsibility to keep it consistent with dictionary. */
  prebuiltTrie?: ReturnType<typeof buildTrie>;
}

export type SearchStopReason = 'target-met' | 'max-candidates' | 'max-ms';

export interface SearchResult {
  board: string;
  score: BoardScore;
  /** Solver output for the chosen board (handy for the caller to display). */
  words: string[];
  strategyUsed: string;
  candidatesEvaluated: number;
  elapsedMs: number;
  reason: SearchStopReason;
}

/**
 * Generate-solve-score in a tight loop, return the best candidate found
 * within budget. The trie is built once per dictionary for hot-path speed.
 *
 * Layer-2 primitive: no model dependency. The intelligence orchestrator
 * (Phase 2) calls this with strategy / weights / recentBoards chosen by the
 * SLM, but `searchForBoard` itself is pure deterministic search.
 */
export const searchForBoard = (config: SearchConfig): SearchResult => {
  const strategy =
    config.strategy ?? defaultStrategyForLanguage(config.language);
  const maxCandidates = config.maxCandidates ?? 75;
  const maxMs = config.maxMs ?? 5000;
  const trie = config.prebuiltTrie ?? buildTrie([...config.dictionary]);
  const t0 = performance.now();

  let bestBoard = '';
  let bestScore: BoardScore | null = null;
  let bestWords: string[] = [];
  let candidatesEvaluated = 0;
  let reason: SearchStopReason = 'max-candidates';

  while (candidatesEvaluated < maxCandidates) {
    if (performance.now() - t0 > maxMs) {
      reason = 'max-ms';
      break;
    }
    const generated = strategy.generate({
      size: config.size,
      language: config.language,
    });
    const words = solveWithTrie(trie, generated.board.split(''));
    const score = scoreBoard(generated.board, words, {
      minWordLength: config.minWordLength,
      recentBoards: config.recentBoards,
      weights: config.scoreWeights,
    });
    candidatesEvaluated++;

    if (bestScore === null || score.finalScore > bestScore.finalScore) {
      bestBoard = generated.board;
      bestScore = score;
      bestWords = words;
    }

    if (
      config.targetScore !== undefined &&
      score.finalScore >= config.targetScore
    ) {
      reason = 'target-met';
      break;
    }
  }

  // Loop guarantees at least one evaluation unless maxCandidates is 0; defend against that.
  if (bestScore === null) {
    throw new Error(
      'searchForBoard requires maxCandidates >= 1; got 0 evaluations'
    );
  }

  return {
    board: bestBoard,
    score: bestScore,
    words: bestWords,
    strategyUsed: strategy.name,
    candidatesEvaluated,
    elapsedMs: performance.now() - t0,
    reason,
  };
};
