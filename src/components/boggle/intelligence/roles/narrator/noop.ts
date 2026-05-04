import type { NarratorRole, ScoredBoardWithCritic, BoardGenerationGoal, RoleContext } from '../types';

/**
 * No-op narrator. Returns empty string. For benchmarks and pipelines that
 * skip the narration step entirely.
 */
export const noopNarrator: NarratorRole = {
  id: 'noop',
  kind: 'narrator',
  async narrate(_args: {
    chosen: ScoredBoardWithCritic;
    goal: BoardGenerationGoal;
    ctx: RoleContext;
  }): Promise<string> {
    return '';
  },
};
