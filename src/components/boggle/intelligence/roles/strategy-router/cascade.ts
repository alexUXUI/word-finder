import type { BoardGenerationGoal, StrategyRouterRole, RoleContext } from '../types';
import { getProviderForId } from '../../local-model/factory';
import { PICK_STRATEGY_SYSTEM } from '../../prompts/router';

export interface CascadeRouterParams {
  /** Ordered model ids to try; each is queried until confidence ≥ threshold. */
  ladder: readonly string[];
  /**
   * Confidence proxy: how many of the parsed strategy ids appeared with
   * matching tokens? With one strategy this is meaningless and the cascade
   * short-circuits to first-tier. With multiple strategies, lower
   * agreement means escalate to the next tier.
   *
   * Today's heuristic: did the model output match a registered strategy
   * exactly (vs falling through to default)? If yes → confident → return.
   * If no → escalate. Replace with a real entropy-based confidence when
   * we have multiple strategies that the SLM actually picks between.
   */
  escalateOnFallback?: boolean;
}

/**
 * Cascade router. Algorithm E from `AI_ENGINEERING.md` §3.
 *
 * Tries a small/cheap model first. If it produces a confident strategy
 * pick (output matched a registered strategy name without falling through
 * to default), return it. Otherwise escalate to the next model in the
 * ladder.
 *
 * Bench question (`p06-cascade` vs `p01-smart-router` running on the
 * largest model only): can the cascade match quality at lower cost?
 *
 * Composition note: this role calls `getProviderForId` directly to
 * traverse its ladder, so it doesn't honor pipeline-level
 * `roleModels['strategy-router']`. The ladder IS the role's model
 * configuration. Other roles still receive their per-role overrides.
 */
export const makeCascadeRouter = (
  params: CascadeRouterParams
): StrategyRouterRole => ({
  id: `cascade:${params.ladder.join('->')}`,
  kind: 'strategy-router',
  async route(
    goal: BoardGenerationGoal,
    available: readonly string[],
    ctx: RoleContext
  ): Promise<string> {
    if (available.length === 1) return available[0];
    if (!params.ladder.length) {
      ctx.narrate?.('⚠️ cascade: empty ladder; defaulting');
      return available[0];
    }

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

    for (let tier = 0; tier < params.ladder.length; tier++) {
      const id = params.ladder[tier];
      const provider = getProviderForId(id);
      if (!provider.isReady) {
        ctx.narrate?.(`⏳ cascade tier ${tier + 1}: loading ${id}…`);
        await provider.load();
      }
      const r = await provider.generate({
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: userMsg },
        ],
        maxTokens: 24,
        temperature: 0.1,
        signal: ctx.signal,
      });
      const lower = r.text.toLowerCase();
      const match = available.find((s) => lower.includes(s.toLowerCase()));
      if (match) {
        if (tier > 0) {
          ctx.narrate?.(`✓ cascade settled on tier ${tier + 1} (${id})`);
        }
        return match;
      }
      // Fell through: model didn't name a registered strategy. Escalate.
      ctx.narrate?.(`↗︎ cascade tier ${tier + 1} unconfident; escalating…`);
    }
    // Exhausted ladder; fall back to first registered strategy.
    return available[0];
  },
});
