import type { CandidateGeneratorRole, ScoredBoard, RoleContext, BoardGenerationGoal } from '../types';
import { searchForBoard } from '../../../generation/search';
import { getStrategy } from '../../../generation/registry';
import { buildTrie } from '../../../logic/trie';
import { solveWithTrie } from '../../../logic/boggle';
import { scoreBoard } from '../../../generation/scorer';

export interface BestOfNParams {
  samples: number;
  /** Wall-clock cap (ms). Default 5000. */
  maxMs?: number;
  /**
   * If true, returns the top-K candidates (sorted desc by finalScore) instead
   * of just the best. Useful for evolutionary / critic-rerank pipelines.
   */
  returnTopK?: number;
}

/**
 * Layer-2 best-of-N over the strategy registry. The default
 * candidate-generator. Wraps `searchForBoard` so the existing search engine
 * powers the role.
 */
export const makeBestOfNGenerator = (params: BestOfNParams): CandidateGeneratorRole => ({
  id: `best-of-n:${params.samples}`,
  kind: 'candidate-generator',
  async generate(args: {
    goal: BoardGenerationGoal;
    strategyId: string;
    seedBoard?: string;
    ctx: RoleContext;
  }): Promise<readonly ScoredBoard[]> {
    const { goal, strategyId, ctx } = args;
    const strategy = getStrategy(strategyId);
    if (!strategy) throw new Error(`unknown strategy: ${strategyId}`);

    if (params.returnTopK && params.returnTopK > 1) {
      // Evolutionary / critic-rerank caller path: build a fresh trie, sample N,
      // sort by finalScore, return top-K. Cheaper than running searchForBoard
      // twice and we control the candidate pool directly.
      const trie = buildTrie([...ctx.dictionary]);
      const pool: ScoredBoard[] = [];
      const t0 = performance.now();
      const cap = params.maxMs ?? 5000;
      for (let i = 0; i < params.samples; i++) {
        if (performance.now() - t0 > cap) break;
        const generated = strategy.generate({ size: goal.size, language: goal.language });
        const words = solveWithTrie(trie, generated.board.split(''));
        const score = scoreBoard(generated.board, words, {
          minWordLength: goal.minWordLength,
          weights: ctx.scoreWeights,
        });
        pool.push({
          board: generated.board,
          words,
          score,
          source: `${strategyId}#${i}`,
        });
        ctx.searchProgress?.({
          index: i + 1,
          total: params.samples,
          bestScore: pool.reduce((m, b) => Math.max(m, b.score.finalScore), 0),
          playerRelevantWords: pool.reduce(
            (m, b) => Math.max(m, b.score.playerRelevantWords),
            0
          ),
        });
      }
      pool.sort((a, b) => b.score.finalScore - a.score.finalScore);
      return pool.slice(0, params.returnTopK);
    }

    // Single-best caller path: route through the production search engine so
    // we keep the existing trace shape and progress callback.
    const result = searchForBoard({
      size: goal.size,
      language: goal.language,
      minWordLength: goal.minWordLength,
      dictionary: [...ctx.dictionary],
      strategy,
      maxCandidates: params.samples,
      maxMs: params.maxMs ?? 5000,
      scoreWeights: ctx.scoreWeights,
      onCandidate: ctx.searchProgress,
    });
    return [
      {
        board: result.board,
        words: result.words,
        score: result.score,
        source: `${strategyId}#best-of-${result.candidatesEvaluated}`,
      },
    ];
  },
});
