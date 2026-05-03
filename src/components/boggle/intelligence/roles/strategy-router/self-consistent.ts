import type { BoardGenerationGoal, StrategyRouterRole, RoleContext } from '../types';
import { PICK_STRATEGY_SYSTEM } from '../../prompts/router';

export interface SelfConsistentRouterParams {
  /** Number of independent SLM samples to take. Odd is best (no ties). Default 5. */
  votes?: number;
  /** Sampling temperature. Default 0.7. Higher → more variance per vote. */
  temperature?: number;
}

/**
 * Self-consistency router. Algorithm F from `AI_ENGINEERING.md` §3.
 *
 * Runs `pick_strategy` N times at temperature T=0.7, then majority-votes
 * over the parsed strategy ids. Reduces single-call variance for free —
 * useful when the model gets confused by edge-case prompts. Trades N×
 * tokens for higher reproducibility.
 *
 * Bench question (`p07-self-consistent` vs `p01-smart-router`): does
 * voting move strategy choice in measurably better ways at fixed budget?
 */
export const makeSelfConsistentRouter = (
  params: SelfConsistentRouterParams = {}
): StrategyRouterRole => {
  const votes = params.votes ?? 5;
  const temperature = params.temperature ?? 0.7;
  return {
    id: `self-consistent:${votes}@${temperature}`,
    kind: 'strategy-router',
    async route(
      goal: BoardGenerationGoal,
      available: readonly string[],
      ctx: RoleContext
    ): Promise<string> {
      if (!ctx.model) return available[0];
      if (available.length === 1) return available[0]; // nothing to vote on

      const sys = PICK_STRATEGY_SYSTEM.replace(
        '{strategies}',
        available.join(', ')
      );
      const userMsg = `Goal: ${JSON.stringify({
        size: goal.size,
        minWordLength: goal.minWordLength,
        style: goal.style ?? 'balanced',
        ...(goal.description ? { description: goal.description } : {}),
      })}\nWhich strategy? Reply with one of: ${available.join(', ')}`;

      const counts = new Map<string, number>();
      for (let i = 0; i < votes; i++) {
        if (ctx.signal?.aborted) break;
        const r = await ctx.model.generate({
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: userMsg },
          ],
          maxTokens: 24,
          temperature,
          signal: ctx.signal,
        });
        const lower = r.text.toLowerCase();
        const match =
          available.find((s) => lower.includes(s.toLowerCase())) ?? available[0];
        counts.set(match, (counts.get(match) ?? 0) + 1);
      }
      // Argmax over counts; ties broken by registry order (available is sorted).
      let bestName = available[0];
      let bestCount = -1;
      for (const name of available) {
        const c = counts.get(name) ?? 0;
        if (c > bestCount) {
          bestCount = c;
          bestName = name;
        }
      }
      return bestName;
    },
  };
};
