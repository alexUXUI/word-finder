import type {
  BoardGenerationGoal,
  PromptParserRole,
  RoleContext,
} from '../types';
import { PARSER_SYSTEM, parseParserResponse } from '../../prompts/parser';

/**
 * SLM prompt parser. Algorithm G from `AI_ENGINEERING.md` §3.
 *
 * If `goal.description` is non-empty, asks the SLM to extract structured
 * fields (style, requiredLetters, themedSuffixes, …) and merges them onto
 * the goal. If the description is empty, this is a passthrough — same
 * behavior as `noopPromptParser`.
 *
 * The merge favors *parser output over the user's pre-existing fields*
 * because the prompt is the player's most-recent expression of intent.
 * However, fields the parser leaves null don't overwrite anything.
 *
 * Bench question (`p05-parsed-prompt-mutator` vs `p02-slm-mutator`): does
 * routing the prompt through the parser produce boards that the SLM judge
 * rates as better-fit-to-prompt?
 */
export const slmPromptParser: PromptParserRole = {
  id: 'slm-parser',
  kind: 'prompt-parser',
  async parse(
    goal: BoardGenerationGoal,
    ctx: RoleContext
  ): Promise<BoardGenerationGoal> {
    const description = goal.description?.trim();
    if (!description) return goal;
    if (!ctx.model) {
      ctx.narrate?.('⚠️ slm-parser: no model in context; passing prompt through unparsed');
      return goal;
    }

    let acc = '';
    const r = await ctx.model.generate({
      messages: [
        { role: 'system', content: PARSER_SYSTEM },
        { role: 'user', content: `Prompt: ${description}\nReturn JSON.` },
      ],
      maxTokens: 128,
      temperature: 0.1,
      jsonOnly: true,
      onToken: ctx.tokenStream
        ? (chunk) => {
            acc += chunk;
            ctx.tokenStream?.(chunk, acc);
          }
        : undefined,
      signal: ctx.signal,
    });

    const fields = parseParserResponse(r.text);
    const merged: BoardGenerationGoal = { ...goal };
    if (typeof fields.style === 'string')
      merged.style = fields.style as BoardGenerationGoal['style'];
    if (typeof fields.difficulty === 'string')
      merged.difficulty = fields.difficulty as BoardGenerationGoal['difficulty'];
    if (typeof fields.novelty === 'string')
      merged.novelty = fields.novelty as BoardGenerationGoal['novelty'];
    if (Array.isArray(fields.requiredLetters))
      merged.requiredLetters = fields.requiredLetters;
    if (Array.isArray(fields.preferredLetters))
      merged.preferredLetters = fields.preferredLetters;
    if (Array.isArray(fields.avoidedLetters))
      merged.avoidedLetters = fields.avoidedLetters;
    if (Array.isArray(fields.themedSuffixes))
      merged.themedSuffixes = fields.themedSuffixes;
    return merged;
  },
};
