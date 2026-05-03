import type { MutatorRole, SwapProposal, BoardGenerationGoal, ScoredBoard, RoleContext } from '../types';

/**
 * Random-swap mutator: picks `k` random distinct cell pairs to swap.
 *
 * Baseline against `slm-swap`. The bench question for algorithm A is whether
 * SLM-proposed swaps dominate random swaps at matched compute — random
 * mutator gives us the control.
 */
export const randomSwapMutator: MutatorRole = {
  id: 'random-swap',
  kind: 'mutator',
  async proposeSwaps(args: {
    board: ScoredBoard;
    goal: BoardGenerationGoal;
    k: number;
    ctx: RoleContext;
  }): Promise<readonly SwapProposal[]> {
    const cells = args.board.board.length;
    const proposals: SwapProposal[] = [];
    const seen = new Set<string>();
    let safety = 0;
    while (proposals.length < args.k && safety < args.k * 10) {
      safety++;
      const i = Math.floor(Math.random() * cells);
      const j = Math.floor(Math.random() * cells);
      if (i === j) continue;
      // Canonicalize to avoid (i,j)/(j,i) duplicates
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Skip swaps between identical letters — they're no-ops
      if (args.board.board[i] === args.board.board[j]) continue;
      proposals.push({ i, j });
    }
    return proposals;
  },
};
