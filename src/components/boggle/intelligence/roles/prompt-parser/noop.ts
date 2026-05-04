import type { BoardGenerationGoal, PromptParserRole } from '../types';

/**
 * Pass-through parser. Used by pipelines that don't try to extract structure
 * from `goal.description`. The Builder prompt threads through unchanged.
 */
export const noopPromptParser: PromptParserRole = {
  id: 'noop',
  kind: 'prompt-parser',
  async parse(goal: BoardGenerationGoal): Promise<BoardGenerationGoal> {
    return goal;
  },
};
