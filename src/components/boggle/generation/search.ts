import { buildTrie } from '../logic/trie';
import { solveWithTrie } from '../logic/boggle';
import type { LanguageType } from '../models';
import { defaultStrategyForLanguage } from './registry';
import type { BoardStrategy } from './types';
import { scoreBoard } from './scorer';
import type { BoardScore, ScoreWeights } from './scorer';
import { NoopTracer } from './trace';
import type { GenerationTrace, Tracer } from './trace';

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
  /**
   * Optional tracer. When provided, search emits a TOOL-type span with
   * candidate-count / score / strategy attributes. Default: NoopTracer.
   */
  tracer?: Tracer;
  /** Identifier joined to player session post-hoc. Defaults to a fresh uuid-ish string. */
  generationId?: string;
  /** Goal signature for trace partitioning. Free-form string; convention: "size=5;min=5;style=balanced". */
  goalSignature?: string;
  /**
   * Fired after each candidate is scored. Use for live progress UI.
   * Cheap — one function call per candidate, no allocation if undefined.
   */
  onCandidate?: (info: {
    index: number;
    total: number;
    finalScore: number;
    bestScore: number;
    playerRelevantWords: number;
  }) => void;
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
  /** Trace produced by the supplied tracer, if any. */
  trace?: GenerationTrace;
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
  const tracer: Tracer = config.tracer ?? NoopTracer;
  const traceHandle = tracer.startTrace({
    generation_id: config.generationId ?? `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    goal_signature:
      config.goalSignature ??
      `size=${config.size};min=${config.minWordLength};lang=${config.language}`,
  });
  const span = traceHandle.startSpan('search.best-of-n', 'TOOL');
  span.setAttribute('strategy', strategy.name);
  span.setAttribute('max_candidates', maxCandidates);
  span.setAttribute('max_ms', maxMs);
  span.setAttribute('size', config.size);
  span.setAttribute('min_word_length', config.minWordLength);
  span.setAttribute('language', config.language);

  const t0 = performance.now();
  let bestBoard = '';
  let bestScore: BoardScore | null = null;
  let bestWords: string[] = [];
  let candidatesEvaluated = 0;
  let reason: SearchStopReason = 'max-candidates';

  try {
    while (candidatesEvaluated < maxCandidates) {
      if (performance.now() - t0 > maxMs) {
        reason = 'max-ms';
        break;
      }
      // Per-candidate span — gives MLflow / dev tooling a clear timeline of
      // every intermediate step inside a generation run.
      const candidateSpan = traceHandle.startSpan(
        `candidate.${candidatesEvaluated}`,
        'TOOL',
        span
      );
      const generateSpan = traceHandle.startSpan(
        'tool.generate',
        'TOOL',
        candidateSpan
      );
      const generated = strategy.generate({
        size: config.size,
        language: config.language,
      });
      generateSpan.setAttribute('strategy', strategy.name);
      generateSpan.setOutputs({ board: generated.board });
      generateSpan.end();

      const solveSpan = traceHandle.startSpan(
        'tool.solve',
        'TOOL',
        candidateSpan
      );
      const words = solveWithTrie(trie, generated.board.split(''));
      solveSpan.setAttribute('total_words', words.length);
      solveSpan.end();

      const scoreSpan = traceHandle.startSpan(
        'tool.score',
        'TOOL',
        candidateSpan
      );
      const score = scoreBoard(generated.board, words, {
        minWordLength: config.minWordLength,
        recentBoards: config.recentBoards,
        weights: config.scoreWeights,
      });
      scoreSpan.setAttribute('final_score', score.finalScore);
      scoreSpan.setAttribute('player_relevant_words', score.playerRelevantWords);
      scoreSpan.setAttribute('max_word_length', score.maxWordLength);
      scoreSpan.end();

      candidateSpan.setAttribute('final_score', score.finalScore);
      candidateSpan.setAttribute('board', generated.board);
      candidateSpan.end();
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

    if (bestScore === null) {
      throw new Error(
        'searchForBoard requires maxCandidates >= 1; got 0 evaluations'
      );
    }

    const elapsedMs = performance.now() - t0;
    span.setAttribute('candidates_evaluated', candidatesEvaluated);
    span.setAttribute('reason', reason);
    span.setAttribute('best_final_score', bestScore.finalScore);
    span.setAttribute('best_player_relevant_words', bestScore.playerRelevantWords);
    span.setOutputs({
      board: bestBoard,
      finalScore: bestScore.finalScore,
      playerRelevantWords: bestScore.playerRelevantWords,
    });
    span.end();

    const trace = traceHandle.finish({
      final_score: bestScore.finalScore,
      final_metrics: { ...bestScore },
      elapsed_ms: elapsedMs,
      candidates_evaluated: candidatesEvaluated,
      model_calls: 0,
      estimated_cost_usd: 0,
      budget_exhausted: reason !== 'target-met',
      selected_strategy: strategy.name,
    });

    return {
      board: bestBoard,
      score: bestScore,
      words: bestWords,
      strategyUsed: strategy.name,
      candidatesEvaluated,
      elapsedMs,
      reason,
      trace: tracer === NoopTracer ? undefined : trace,
    };
  } catch (e) {
    const err = e as Error;
    span.recordError({ message: err.message, stack: err.stack });
    span.end();
    throw e;
  }
};
