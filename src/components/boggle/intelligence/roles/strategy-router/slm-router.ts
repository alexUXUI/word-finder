import type { BoardGenerationGoal, StrategyRouterRole, RoleContext } from '../types';
import { PICK_STRATEGY_SYSTEM } from '../../prompts/router';

/**
 * SLM-driven strategy selection. The previous procedural orchestrator's
 * `pick_strategy` step, isolated as a role.
 *
 * Bench question (`p01-smart-router` vs `p00-deterministic` /
 * `rule-based-router`): does the SLM's choice produce measurably better
 * boards than the rule table at matched compute?
 */
export const slmRouter: StrategyRouterRole = {
  id: 'slm-router',
  kind: 'strategy-router',
  async route(
    goal: BoardGenerationGoal,
    available: readonly string[],
    ctx: RoleContext
  ): Promise<string> {
    if (!ctx.model) {
      // Defensive: a misconfigured pipeline shouldn't crash; fall back to the
      // first available strategy and log a narration line so the trace
      // surfaces the misconfiguration.
      ctx.narrate?.('⚠️ slm-router: no model in context; defaulting');
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
      difficulty: goal.difficulty ?? 'medium',
      novelty: goal.novelty ?? 'medium',
      ...(goal.description ? { description: goal.description } : {}),
    })}\nWhich strategy? Reply with one of: ${available.join(', ')}`;

    let acc = '';
    const r = await ctx.model.generate({
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userMsg },
      ],
      maxTokens: 24,
      temperature: 0.1,
      onToken: ctx.tokenStream
        ? (chunk) => {
            acc += chunk;
            ctx.tokenStream?.(chunk, acc);
          }
        : undefined,
      signal: ctx.signal,
    });
    const lower = r.text.toLowerCase();
    return available.find((s) => lower.includes(s.toLowerCase())) ?? available[0];
  },
};
