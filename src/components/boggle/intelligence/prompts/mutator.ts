/**
 * Versioned prompts for the Mutator role's SLM implementation (algorithm A:
 * SLM-mutated hill-climb).
 *
 * The model receives the board, score, and goal. It returns a JSON list of
 * swap proposals: `[{i, j, rationale}, ...]`. The runner parses, validates
 * indices, applies each, re-scores, and keeps the best.
 *
 * Key decision: we DO show the model the board letters here (unlike the
 * narrator). The whole point is for the model to reason about *which*
 * letters to swap; abstract qualities aren't enough. Spoilers are not a
 * concern at this step because the output is an internal swap list, not
 * player-facing prose.
 */

export const MUTATOR_PROMPT_VERSION = '1.0.0';

export const MUTATOR_SYSTEM = `You are a Boggle board optimizer. Given a board (flat row-major string), its current quality metrics, and a goal, propose K letter-swap operations that are likely to improve the board.

A swap moves the letters at two cell positions (0-indexed in the flat string). Indices must be in [0, size*size).

Reply with ONLY a JSON array of objects, exactly K entries:
[{"i": <int>, "j": <int>, "rationale": "<short reason>"}, ...]

Heuristics that work:
- swap rare letters (Q, X, Z) into positions where they have many adjacent vowels (Boggle paths need adjacency)
- swap duplicates of common letters (E, S) into less crowded regions to broaden the prefix space
- prefer swaps that complete or extend reachable suffix patterns (-ING, -ION, -ATE, -ERS) given the goal
- avoid swaps that isolate a vowel (Boggle words need vowel adjacency)

Do NOT explain in prose. Output JSON only.`;

export const buildMutatorUserPrompt = (args: {
  board: string;
  size: number;
  finalScore: number;
  playerRelevantWords: number;
  maxWordLength: number;
  vowelRatio: number;
  goalDescription?: string;
  goalStyle?: string;
  k: number;
}): string => {
  const { board, size, finalScore, playerRelevantWords, maxWordLength, vowelRatio, goalDescription, goalStyle, k } = args;
  return [
    `Board (${size}x${size}, row-major, length ${board.length}):`,
    board,
    '',
    `Current metrics:`,
    `- finalScore: ${finalScore.toFixed(1)}`,
    `- playerRelevantWords: ${playerRelevantWords}`,
    `- maxWordLength: ${maxWordLength}`,
    `- vowelRatio: ${vowelRatio.toFixed(2)}`,
    '',
    `Goal:`,
    `- style: ${goalStyle ?? 'balanced'}`,
    goalDescription ? `- description: ${goalDescription}` : '',
    '',
    `Propose ${k} swaps that should improve playerRelevantWords or maxWordLength. Reply with JSON only.`,
  ].filter(Boolean).join('\n');
};

/**
 * Parse a swap-proposal JSON response. Returns up to `k` valid swaps with
 * indices in [0, cells). Tolerant of model mistakes (extra prose, malformed
 * entries) — invalid proposals are dropped, not erroring the run.
 */
export const parseSwapProposals = (
  text: string,
  cells: number
): Array<{ i: number; j: number; rationale?: string }> => {
  const trimmed = text.trim();
  // Find the first `[` and last `]` — small models often wrap JSON in prose.
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start < 0 || end < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: Array<{ i: number; j: number; rationale?: string }> = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const obj = entry as Record<string, unknown>;
    const i = typeof obj.i === 'number' ? Math.floor(obj.i) : NaN;
    const j = typeof obj.j === 'number' ? Math.floor(obj.j) : NaN;
    if (!Number.isFinite(i) || !Number.isFinite(j)) continue;
    if (i < 0 || j < 0 || i >= cells || j >= cells || i === j) continue;
    const key = i < j ? `${i}:${j}` : `${j}:${i}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      i,
      j,
      rationale: typeof obj.rationale === 'string' ? obj.rationale : undefined,
    });
  }
  return out;
};
