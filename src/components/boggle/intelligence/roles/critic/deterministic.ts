import type { CriticRole, ScoredBoard, BoardGenerationGoal, RoleContext } from '../types';

/**
 * Deterministic critic: compresses `BoardScore.finalScore` into [0,1] using a
 * scaling reference. Default reference is 1000 (which is roughly the
 * upper-bound finalScore on a strong 5x5 in practice).
 *
 * This is the production critic when the pipeline doesn't need a
 * goal-adherence judgment. Layer-1 pure; no model.
 */
export const makeDeterministicCritic = (
  scaleReference = 1000
): CriticRole => ({
  id: `deterministic-scorer:${scaleReference}`,
  kind: 'critic',
  async rate(args: {
    board: ScoredBoard;
    goal: BoardGenerationGoal;
    ctx: RoleContext;
  }): Promise<number> {
    const { finalScore } = args.board.score;
    if (!Number.isFinite(finalScore)) return 0;
    const ratio = finalScore / scaleReference;
    if (ratio <= 0) return 0;
    if (ratio >= 1) return 1;
    return ratio;
  },
});
