import type { CriticRole, ScoredBoard, BoardGenerationGoal, RoleContext } from '../types';

/**
 * SLM judge — rates a board's *fit to the goal description* on 0..1. Used
 * for subjective metrics no deterministic scorer can express (e.g. "this
 * prompt asked for -ING-tail-friendly boards; does this look like one?").
 *
 * Calibration is gated separately (see `EVAL_SUITE.md` §calibration). Until
 * the judge agrees with humans on the player-rated set, its output is
 * reported but doesn't gate promotions.
 */

const JUDGE_SYSTEM = `You are a Boggle board judge. Rate how well a 5x5 board matches a player's request, on a scale of 0.0 to 1.0.

Criteria:
- Style adherence: does the board's letter mix support the requested style (e.g. long-word, rare-letter, themed)?
- Constraint satisfaction: required/avoided letters honored?
- Quality: enough player-relevant words and prefix variety?

Reply with ONLY a JSON object: {"rating": <float 0..1>, "reasoning": "<one short sentence>"}`;

export const slmJudgeCritic: CriticRole = {
  id: 'slm-judge',
  kind: 'critic',
  async rate(args: {
    board: ScoredBoard;
    goal: BoardGenerationGoal;
    ctx: RoleContext;
  }): Promise<number> {
    const { board, goal, ctx } = args;
    if (!ctx.model) return 0.5; // neutral when no model — judge non-binding

    const userMsg = [
      `Board (${goal.size}x${goal.size}, row-major):`,
      board.board,
      '',
      `Player request:`,
      `- style: ${goal.style ?? 'balanced'}`,
      goal.description ? `- description: ${goal.description}` : '',
      goal.requiredLetters?.length
        ? `- requiredLetters: ${goal.requiredLetters.join(', ')}`
        : '',
      goal.avoidedLetters?.length
        ? `- avoidedLetters: ${goal.avoidedLetters.join(', ')}`
        : '',
      goal.themedSuffixes?.length
        ? `- themedSuffixes: ${goal.themedSuffixes.join(', ')}`
        : '',
      '',
      `Stats: ${board.score.playerRelevantWords} player-words, max length ${board.score.maxWordLength}, vowel ratio ${board.score.vowelRatio.toFixed(2)}.`,
      '',
      `Rate 0.0 to 1.0. JSON only.`,
    ]
      .filter(Boolean)
      .join('\n');

    const r = await ctx.model.generate({
      messages: [
        { role: 'system', content: JUDGE_SYSTEM },
        { role: 'user', content: userMsg },
      ],
      maxTokens: 64,
      temperature: 0.1,
      jsonOnly: true,
      signal: ctx.signal,
    });

    // Tolerant parsing: extract first {...} block, look for "rating" number.
    const trimmed = r.text.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end < 0 || end <= start) return 0.5;
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      const rating = typeof parsed.rating === 'number' ? parsed.rating : 0.5;
      if (!Number.isFinite(rating)) return 0.5;
      return Math.max(0, Math.min(1, rating));
    } catch {
      return 0.5;
    }
  },
};
