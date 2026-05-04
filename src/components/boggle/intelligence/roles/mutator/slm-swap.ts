import type { MutatorRole, SwapProposal, BoardGenerationGoal, ScoredBoard, RoleContext } from '../types';
import { MUTATOR_SYSTEM, buildMutatorUserPrompt, parseSwapProposals } from '../../prompts/mutator';

export interface SlmSwapMutatorParams {
  /** Override the system prompt — used by the prompt optimizer. */
  promptOverride?: string;
}

const buildSlmSwapMutator = (
  params: SlmSwapMutatorParams = {}
): MutatorRole => ({
  id: params.promptOverride ? 'slm-swap:override' : 'slm-swap',
  kind: 'mutator',
  async proposeSwaps(args: {
    board: ScoredBoard;
    goal: BoardGenerationGoal;
    k: number;
    ctx: RoleContext;
  }): Promise<readonly SwapProposal[]> {
    const { board, goal, k, ctx } = args;
    if (!ctx.model) {
      ctx.narrate?.('⚠️ slm-swap: no model in context; skipping mutation');
      return [];
    }
    const userMsg = buildMutatorUserPrompt({
      board: board.board,
      size: goal.size,
      finalScore: board.score.finalScore,
      playerRelevantWords: board.score.playerRelevantWords,
      maxWordLength: board.score.maxWordLength,
      vowelRatio: board.score.vowelRatio,
      goalDescription: goal.description,
      goalStyle: goal.style,
      k,
    });

    let acc = '';
    const r = await ctx.model.generate({
      messages: [
        { role: 'system', content: params.promptOverride ?? MUTATOR_SYSTEM },
        { role: 'user', content: userMsg },
      ],
      // K swaps × ~30 tokens each + JSON scaffolding
      maxTokens: Math.max(96, k * 40),
      temperature: 0.3,
      jsonOnly: true,
      onToken: ctx.tokenStream
        ? (chunk) => {
            acc += chunk;
            ctx.tokenStream?.(chunk, acc);
          }
        : undefined,
      signal: ctx.signal,
    });

    const proposals = parseSwapProposals(r.text, board.board.length);
    // Take at most K valid swaps; if the model gave us none we return empty
    // and the runner skips this iteration (better than fabricating swaps).
    return proposals.slice(0, k);
  },
});

export const slmSwapMutator: MutatorRole = buildSlmSwapMutator();
export const makeSlmSwapMutatorWithOverride = buildSlmSwapMutator;
