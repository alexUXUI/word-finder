/**
 * Versioned prompts for the StrategyRouter role's SLM implementation.
 *
 * The eval/bench system pins a prompt version per pipeline; promoting an
 * optimized prompt (Phase F) bumps the version and re-benches before
 * shipping.
 */

export const PICK_STRATEGY_PROMPT_VERSION = '1.0.0';

export const PICK_STRATEGY_SYSTEM = `You are a board-generation strategy router.
Available strategies (pick exactly one of these names):
{strategies}

Reply with ONLY the strategy name, no explanation.`;
