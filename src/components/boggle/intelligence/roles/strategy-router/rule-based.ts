import type { BoardGenerationGoal, StrategyRouterRole, RoleContext } from '../types';

export interface RuleBasedRouterParams {
  /** Strategy returned when no rule matches. */
  default: string;
  /** style → strategy override. */
  byStyle?: Readonly<Record<string, string>>;
}

/**
 * Heuristic router. Zero-cost; deterministic. Useful as a baseline against
 * `slm-router` so the bench can answer "does the SLM's strategy choice
 * actually beat the rule table?"
 */
export const makeRuleBasedRouter = (
  params: RuleBasedRouterParams
): StrategyRouterRole => ({
  id: `rule-based:${params.default}`,
  kind: 'strategy-router',
  async route(
    goal: BoardGenerationGoal,
    available: readonly string[],
    _ctx: RoleContext
  ): Promise<string> {
    const fromStyle = goal.style && params.byStyle?.[goal.style];
    const candidate = fromStyle ?? params.default;
    return available.includes(candidate) ? candidate : available[0];
  },
});
