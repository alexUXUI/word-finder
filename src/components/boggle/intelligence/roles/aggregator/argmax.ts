import type { AggregatorRole, ScoredBoardWithCritic, BoardGenerationGoal, RoleContext } from '../types';

/**
 * Argmax aggregator: pick the candidate with the highest finalScore (or, if
 * a critic ran, the highest `critic` rating). The default aggregator.
 *
 * Future implementations: `pareto` (multi-metric frontier), `bandit` (UCB),
 * `llm-rerank` (SLM picks the winner from the top-K).
 */
export const argmaxAggregator: AggregatorRole = {
  id: 'argmax',
  kind: 'aggregator',
  async pick(args: {
    candidates: readonly ScoredBoardWithCritic[];
    goal: BoardGenerationGoal;
    ctx: RoleContext;
  }): Promise<ScoredBoardWithCritic> {
    if (args.candidates.length === 0) {
      throw new Error('aggregator received empty candidate list');
    }
    let best = args.candidates[0];
    for (const c of args.candidates.slice(1)) {
      const bScore = best.critic ?? best.score.finalScore;
      const cScore = c.critic ?? c.score.finalScore;
      if (cScore > bScore) best = c;
    }
    return best;
  },
};
