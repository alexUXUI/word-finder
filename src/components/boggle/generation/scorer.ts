/**
 * Pure board-scoring function. Layer-1 deterministic primitive — no model
 * dependency, no I/O, no globals. The search engine calls this on every
 * candidate.
 *
 * The score has two parts: raw metrics (so we can analyze and tune) and a
 * weighted `finalScore` (so the search engine has a single number to
 * maximize). Weights are exposed and tunable per-call.
 */

const ENGLISH_VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

export interface BoardScore {
  /** All words returned by solve(). */
  totalWords: number;
  /** Words >= minWordLength. The headline gameplay metric. */
  playerRelevantWords: number;
  /** Length → count, for distribution analysis. */
  wordsByLength: Readonly<Record<number, number>>;
  averageWordLength: number;
  maxWordLength: number;
  /** Distinct letters present in the board (1..26). */
  uniqueLetters: number;
  /** Vowels / total cells. */
  vowelRatio: number;
  /** Sorted vowel multiset signature; identical strings = same vowel inventory. */
  vowelInventoryHash: string;
  /** Distinct 2-letter prefixes among player-relevant words. */
  prefixDiversity: number;
  /** Shannon entropy (bits) on the board's letter distribution. */
  letterEntropy: number;
  /** Max Jaccard against `recentBoards`. 0 when no recents supplied. */
  similarityToRecent: number;
  /** Aggregate. Higher is better. */
  finalScore: number;
}

export interface ScoreWeights {
  playerRelevantWords: number;
  maxWordLength: number;
  averageWordLength: number;
  prefixDiversity: number;
  letterEntropy: number;
  similarityPenalty: number;
  vowelRatioOptimum: number;
  /** Target vowel ratio (0..1). 0.38 ≈ English text. */
  vowelRatioOptimumValue: number;
  /** Allowed deviation from target before bonus decays linearly to 0. */
  vowelRatioTolerance: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  playerRelevantWords: 1.0,
  maxWordLength: 5.0,
  averageWordLength: 3.0,
  prefixDiversity: 0.5,
  letterEntropy: 10.0,
  similarityPenalty: 50.0,
  vowelRatioOptimum: 20.0,
  vowelRatioOptimumValue: 0.38,
  vowelRatioTolerance: 0.1,
};

export interface ScoreOptions {
  minWordLength?: number;
  /** Used for similarity penalty; pass the last N boards' player-relevant word sets. */
  recentBoards?: ReadonlyArray<{ board: string; playerRelevantWords: readonly string[] }>;
  weights?: Partial<ScoreWeights>;
}

export const scoreBoard = (
  board: string,
  solvedWords: readonly string[],
  options: ScoreOptions = {}
): BoardScore => {
  const minWordLength = options.minWordLength ?? 5;
  const weights: ScoreWeights = { ...DEFAULT_WEIGHTS, ...(options.weights ?? {}) };

  const playerRelevant = solvedWords.filter((w) => w.length >= minWordLength);

  const wordsByLength: Record<number, number> = {};
  let lenSum = 0;
  let maxLen = 0;
  for (const w of solvedWords) {
    wordsByLength[w.length] = (wordsByLength[w.length] ?? 0) + 1;
    lenSum += w.length;
    if (w.length > maxLen) maxLen = w.length;
  }
  const averageWordLength = solvedWords.length ? lenSum / solvedWords.length : 0;

  const cells = [...board.toLowerCase()];
  const letterCounts = new Map<string, number>();
  let vowelCount = 0;
  for (const c of cells) {
    letterCounts.set(c, (letterCounts.get(c) ?? 0) + 1);
    if (ENGLISH_VOWELS.has(c)) vowelCount++;
  }
  const uniqueLetters = letterCounts.size;
  const vowelRatio = cells.length ? vowelCount / cells.length : 0;
  const vowelInventoryHash = cells
    .filter((c) => ENGLISH_VOWELS.has(c))
    .sort()
    .join('');

  let letterEntropy = 0;
  if (cells.length > 0) {
    for (const count of letterCounts.values()) {
      const p = count / cells.length;
      if (p > 0) letterEntropy -= p * Math.log2(p);
    }
  }

  const prefixes = new Set<string>();
  for (const w of playerRelevant) prefixes.add(w.slice(0, 2));
  const prefixDiversity = prefixes.size;

  let similarityToRecent = 0;
  if (options.recentBoards && options.recentBoards.length > 0) {
    const a = new Set(playerRelevant);
    for (const rb of options.recentBoards) {
      const b = new Set(
        rb.playerRelevantWords.filter((w) => w.length >= minWordLength)
      );
      if (a.size === 0 && b.size === 0) continue;
      const inter = new Set([...a].filter((x) => b.has(x)));
      const union = new Set([...a, ...b]);
      const j = union.size === 0 ? 0 : inter.size / union.size;
      if (j > similarityToRecent) similarityToRecent = j;
    }
  }

  const vowelDelta = Math.abs(vowelRatio - weights.vowelRatioOptimumValue);
  const vowelRatioBonus =
    vowelDelta <= weights.vowelRatioTolerance
      ? weights.vowelRatioOptimum
      : Math.max(
          0,
          weights.vowelRatioOptimum * (1 - (vowelDelta - weights.vowelRatioTolerance) / 0.2)
        );

  const finalScore =
    weights.playerRelevantWords * playerRelevant.length +
    weights.maxWordLength * maxLen +
    weights.averageWordLength * averageWordLength +
    weights.prefixDiversity * prefixDiversity +
    weights.letterEntropy * letterEntropy +
    vowelRatioBonus -
    weights.similarityPenalty * similarityToRecent;

  return {
    totalWords: solvedWords.length,
    playerRelevantWords: playerRelevant.length,
    wordsByLength,
    averageWordLength,
    maxWordLength: maxLen,
    uniqueLetters,
    vowelRatio,
    vowelInventoryHash,
    prefixDiversity,
    letterEntropy,
    similarityToRecent,
    finalScore,
  };
};
