import type { NarratorRole, ScoredBoardWithCritic, BoardGenerationGoal, RoleContext } from '../types';
import { EXPLAIN_SYSTEM, dedupeSentences } from '../../prompts/narrator';

/**
 * SLM-driven narrator. Today's `model.explain` step, isolated as a role.
 *
 * Hard contract: never spoils a word. Only counts/ratios are passed to the
 * model — never the board letters or solver output. `dedupeSentences` strips
 * the smaller models' tendency to loop.
 */
export const slmNarrator: NarratorRole = {
  id: 'slm-narrator',
  kind: 'narrator',
  async narrate(args: {
    chosen: ScoredBoardWithCritic;
    goal: BoardGenerationGoal;
    ctx: RoleContext;
  }): Promise<string> {
    const { chosen, goal, ctx } = args;
    if (!ctx.model) return '';

    const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
    const cells = [...chosen.board.toLowerCase()];
    const vowelCount = cells.filter((c) => VOWELS.has(c)).length;
    const rareLetters = cells.filter((c) => 'jkqvxz'.includes(c)).length;
    const userMsg = [
      `${goal.size}x${goal.size} grid.`,
      `Player goal: words ≥${goal.minWordLength} letters.`,
      `Available: ${chosen.score.playerRelevantWords} player-relevant words; longest length ${chosen.score.maxWordLength}.`,
      `Vowel ratio: ${(vowelCount / cells.length).toFixed(2)}.`,
      rareLetters
        ? `Rare letters present: ${rareLetters} (good for unusual words).`
        : 'No rare letters.',
      `Style: ${goal.style ?? 'balanced'}.`,
      'Hype the player. NEVER spoil specific words.',
    ].join('\n');

    let acc = '';
    const r = await ctx.model.generate({
      messages: [
        { role: 'system', content: EXPLAIN_SYSTEM },
        { role: 'user', content: userMsg },
      ],
      maxTokens: 80,
      temperature: 0.25,
      onToken: ctx.tokenStream
        ? (chunk) => {
            acc += chunk;
            ctx.tokenStream?.(chunk, acc);
          }
        : undefined,
      signal: ctx.signal,
    });
    return dedupeSentences(r.text.trim());
  },
};
