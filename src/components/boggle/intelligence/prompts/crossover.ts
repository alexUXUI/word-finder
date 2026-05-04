/**
 * Versioned prompts for the SLM-as-crossover operator (algorithm B —
 * evolutionary search). The model sees a pair of parent boards plus their
 * scores and proposes a child that combines the strong features of both.
 *
 * Output is a 25-character flat board string. Tolerant parsing strips
 * whitespace and any prose preamble. If the response isn't 25 cells of
 * a-z, the runner falls back to a deterministic crossover (random
 * column-pick from each parent) so a bad SLM call doesn't break the
 * generation.
 */

export const CROSSOVER_PROMPT_VERSION = '1.0.0';

export const CROSSOVER_SYSTEM = `You are a Boggle board recombination operator.

Given two parent boards (flat row-major strings) and their quality
metrics, produce a child board that combines the *strong subgrids* of
both parents while keeping Boggle-valid letter density (vowels reachable
from consonants on every path).

Reply with ONLY the child board as a single 25-character lowercase string.
No prose, no JSON, no quotes — just 25 letters a-z.

Heuristics:
- preserve regions where one parent has many long words
- combine vowel-rich rows from one parent with consonant-rich rows from the other
- keep rare letters (Q, X, Z) in positions where adjacent vowels exist
- avoid creating large vowel deserts or consonant clusters`;

export const buildCrossoverUserPrompt = (args: {
  parentA: { board: string; finalScore: number; playerWords: number };
  parentB: { board: string; finalScore: number; playerWords: number };
  size: number;
  goalStyle?: string;
  goalDescription?: string;
}): string => {
  const { parentA, parentB, size, goalStyle, goalDescription } = args;
  return [
    `Parent A (${size}x${size}):`,
    parentA.board,
    `  finalScore=${parentA.finalScore.toFixed(0)}, playerWords=${parentA.playerWords}`,
    '',
    `Parent B (${size}x${size}):`,
    parentB.board,
    `  finalScore=${parentB.finalScore.toFixed(0)}, playerWords=${parentB.playerWords}`,
    '',
    `Goal style: ${goalStyle ?? 'balanced'}`,
    goalDescription ? `Goal description: ${goalDescription}` : '',
    '',
    `Output a single 25-character child board, lowercase a-z, no other text.`,
  ]
    .filter(Boolean)
    .join('\n');
};

/**
 * Parse the SLM's child-board response. Tolerates leading prose, code
 * fences, etc. Returns the first run of `expectedLength` lowercase a-z
 * characters found, or null if no valid run exists.
 */
export const parseCrossoverResponse = (
  text: string,
  expectedLength: number
): string | null => {
  const cleaned = text.toLowerCase().replace(/[^a-z]/g, '');
  if (cleaned.length < expectedLength) return null;
  return cleaned.slice(0, expectedLength);
};

/**
 * Deterministic crossover fallback: half rows from parent A, half from
 * parent B, alternating. Used when the SLM call fails or returns garbage.
 */
export const deterministicCrossover = (
  parentA: string,
  parentB: string,
  size: number
): string => {
  const cells: string[] = [];
  for (let row = 0; row < size; row++) {
    const src = row % 2 === 0 ? parentA : parentB;
    for (let col = 0; col < size; col++) {
      cells.push(src[row * size + col] ?? 'a');
    }
  }
  return cells.join('');
};
