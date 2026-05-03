/**
 * Versioned prompts for the PromptParser role's SLM implementation
 * (algorithm G — slm-parsed-prompt). Free-form NL prompt → structured
 * `BoardGenerationGoal` fields.
 *
 * F1 metric: parser output vs `evals/prompts.yaml` ground-truth. Below an
 * F1 threshold the parser is non-binding (its output is reported but the
 * pipeline falls through to the user's original goal fields).
 */

export const PARSER_PROMPT_VERSION = '1.0.0';

export const PARSER_SYSTEM = `You parse free-form board-generation prompts into structured fields.

Output JSON ONLY, no prose. Schema:
{
  "style": "balanced" | "long-word-heavy" | "classic" | "rare-letter" | "chaotic" | null,
  "difficulty": "easy" | "medium" | "hard" | null,
  "novelty": "low" | "medium" | "high" | null,
  "requiredLetters": [string] | null,
  "preferredLetters": [string] | null,
  "avoidedLetters": [string] | null,
  "themedSuffixes": [string] | null,
  "themedPrefixes": [string] | null
}

Rules:
- "long words", "8+ letter", "longer", "complex" → style: "long-word-heavy"
- "rare", "weird letters", "Q Z X J" mentions → style: "rare-letter"
- "chaotic", "wild", "high-variance" → style: "chaotic"
- "classic", "traditional", "4x4" → style: "classic"
- "easy", "beginner", "friendly" → difficulty: "easy"; "hard", "expert", "competitive" → difficulty: "hard"
- "no Q", "no X", "without Z" → avoidedLetters
- "include", "must have", "with Q" → requiredLetters
- "ending in -ing", "-ED words" → themedSuffixes (lowercase, no dash)
- Use null when the prompt doesn't clearly suggest a value. Do NOT guess.`;

/**
 * Parse the SLM's JSON response. Tolerant: extracts the first {...} block.
 * Returns a normalized partial goal; null fields are dropped.
 */
export const parseParserResponse = (
  text: string
): Partial<{
  style: string;
  difficulty: string;
  novelty: string;
  requiredLetters: string[];
  preferredLetters: string[];
  avoidedLetters: string[];
  themedSuffixes: string[];
  themedPrefixes: string[];
}> => {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) return {};
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return {};
  }
  const out: Record<string, unknown> = {};
  const stringFields = ['style', 'difficulty', 'novelty'];
  const arrayFields = [
    'requiredLetters',
    'preferredLetters',
    'avoidedLetters',
    'themedSuffixes',
    'themedPrefixes',
  ];
  const VALID_STYLE = new Set([
    'balanced',
    'long-word-heavy',
    'classic',
    'rare-letter',
    'chaotic',
  ]);
  const VALID_DIFF = new Set(['easy', 'medium', 'hard']);
  const VALID_NOV = new Set(['low', 'medium', 'high']);
  for (const k of stringFields) {
    const v = parsed[k];
    if (typeof v !== 'string') continue;
    const lc = v.toLowerCase();
    if (k === 'style' && VALID_STYLE.has(lc)) out[k] = lc;
    if (k === 'difficulty' && VALID_DIFF.has(lc)) out[k] = lc;
    if (k === 'novelty' && VALID_NOV.has(lc)) out[k] = lc;
  }
  for (const k of arrayFields) {
    const v = parsed[k];
    if (!Array.isArray(v)) continue;
    const cleaned = v
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.toLowerCase().trim())
      .filter(Boolean);
    if (cleaned.length) out[k] = cleaned;
  }
  return out;
};

/**
 * F1 score between parser output and ground truth. Used by the bench to
 * gate algorithm G's promotion. 1.0 = perfect; 0.0 = no overlap.
 *
 * String fields contribute 1 to TP if both present and equal, FP if parser
 * has wrong value, FN if parser has null and truth has value.
 *
 * Array fields use set-level F1 across the union of items.
 */
export const f1ParserOutput = (
  predicted: Record<string, unknown>,
  truth: Record<string, unknown>
): number => {
  const fields = [
    'style',
    'difficulty',
    'novelty',
    'requiredLetters',
    'preferredLetters',
    'avoidedLetters',
    'themedSuffixes',
    'themedPrefixes',
  ];
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const f of fields) {
    const p = predicted[f];
    const t = truth[f];
    if (Array.isArray(t) || Array.isArray(p)) {
      const ts = new Set((t as string[] | undefined) ?? []);
      const ps = new Set((p as string[] | undefined) ?? []);
      for (const x of ps) (ts.has(x) ? tp++ : fp++);
      for (const x of ts) if (!ps.has(x)) fn++;
    } else {
      if (t === undefined || t === null) {
        if (p !== undefined && p !== null) fp++;
      } else {
        if (p === t) tp++;
        else if (p === undefined || p === null) fn++;
        else {
          fp++;
          fn++;
        }
      }
    }
  }
  if (tp + fp === 0 && tp + fn === 0) return 1; // no fields to evaluate → ok
  if (tp === 0) return 0;
  const precision = tp / (tp + fp);
  const recall = tp / (tp + fn);
  return (2 * precision * recall) / (precision + recall);
};
