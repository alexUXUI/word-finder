import type { BoardGenerationGoal, StrategyRouterRole, RoleContext } from '../types';
import { PICK_STRATEGY_SYSTEM } from '../../prompts/router';

export interface SlmRouterParams {
  /**
   * Override the system prompt for the strategy-router. Used by the prompt
   * optimizer (`tools/optimizer/`) to bench variants against the baseline
   * without modifying the canonical prompt module. `{strategies}` token
   * still gets templated.
   */
  promptOverride?: string;
}

const buildSlmRouter = (params: SlmRouterParams = {}): StrategyRouterRole => ({
  id: params.promptOverride ? 'slm-router:override' : 'slm-router',
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
    const sys = (params.promptOverride ?? PICK_STRATEGY_SYSTEM).replace(
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
});

/** Default singleton — used by p01/p05/p07. */
export const slmRouter: StrategyRouterRole = buildSlmRouter();

/** Factory for the optimizer to inject prompt variants. */
export const makeSlmRouterWithOverride = buildSlmRouter;
