import { describe, it, expect } from 'vitest';
import { scoreBoard, DEFAULT_WEIGHTS } from '../../src/components/boggle/generation/scorer';

describe('scoreBoard()', () => {
  const aaa25 = 'a'.repeat(25);
  const cats4x4 = 'catsdogeplanston';

  it('returns zero word counts for an empty solution', () => {
    const s = scoreBoard(cats4x4, []);
    expect(s.totalWords).toBe(0);
    expect(s.playerRelevantWords).toBe(0);
    expect(s.maxWordLength).toBe(0);
    expect(s.averageWordLength).toBe(0);
  });

  it('counts words by length', () => {
    const s = scoreBoard(cats4x4, ['cat', 'cats', 'dog', 'plant', 'plants']);
    expect(s.totalWords).toBe(5);
    expect(s.wordsByLength).toEqual({ 3: 2, 4: 1, 5: 1, 6: 1 });
  });

  it('honors minWordLength when counting playerRelevantWords', () => {
    const s = scoreBoard(cats4x4, ['cat', 'cats', 'dog', 'plant', 'plants'], {
      minWordLength: 5,
    });
    expect(s.playerRelevantWords).toBe(2); // plant, plants
  });

  it('computes uniqueLetters and vowelRatio from the board', () => {
    const s = scoreBoard(aaa25, []);
    expect(s.uniqueLetters).toBe(1);
    expect(s.vowelRatio).toBeCloseTo(1.0);
  });

  it('emits a stable vowelInventoryHash regardless of position', () => {
    const a = scoreBoard('aeiouxxxxxxxxxxxxxxxxxxxx', []);
    const b = scoreBoard('xxxxxxxxxxxxxxxxxxxxxaeiou', []);
    expect(a.vowelInventoryHash).toBe(b.vowelInventoryHash);
  });

  it('counts distinct 2-letter prefixes among player-relevant words only', () => {
    // Default minWordLength = 5. So `cat`/`cats`/`plan` are excluded,
    // leaving plant + plate (both `pl`) and react (`re`) → 2 distinct prefixes.
    const s = scoreBoard(cats4x4, ['plan', 'plant', 'plate', 'react', 'cat', 'cats']);
    expect(s.prefixDiversity).toBe(2);
  });

  it('similarity to recent: identical word set yields max penalty', () => {
    const words = ['plant', 'plants'];
    const recent = [{ board: cats4x4, playerRelevantWords: words }];
    const s = scoreBoard(cats4x4, words, { recentBoards: recent });
    expect(s.similarityToRecent).toBeCloseTo(1.0);
  });

  it('similarity: completely disjoint word set yields 0', () => {
    const recent = [
      { board: cats4x4, playerRelevantWords: ['quartz', 'foobar'] },
    ];
    const s = scoreBoard(cats4x4, ['plant', 'plants'], { recentBoards: recent });
    expect(s.similarityToRecent).toBe(0);
  });

  it('finalScore monotonic in playerRelevantWords (all else equal)', () => {
    const a = scoreBoard(cats4x4, ['plant']);
    const b = scoreBoard(cats4x4, ['plant', 'plants']);
    expect(b.finalScore).toBeGreaterThan(a.finalScore);
  });

  it('finalScore drops as similarity to recent increases', () => {
    const words = ['plant', 'plants'];
    const aRecent = [{ board: 'x', playerRelevantWords: ['quartz'] }];
    const bRecent = [{ board: 'x', playerRelevantWords: words }];
    const a = scoreBoard(cats4x4, words, { recentBoards: aRecent });
    const b = scoreBoard(cats4x4, words, { recentBoards: bRecent });
    expect(a.finalScore).toBeGreaterThan(b.finalScore);
  });

  it('vowel-ratio bonus peaks near the configured optimum', () => {
    // 38% vowels = ~9-10 of 25 cells
    const optimumBoard = 'aeioutestmoreboardrandlett'.slice(0, 25);
    // 100% vowels — far from optimum
    const tooManyVowels = 'a'.repeat(25);
    const optimum = scoreBoard(optimumBoard, []);
    const skewed = scoreBoard(tooManyVowels, []);
    expect(optimum.finalScore).toBeGreaterThan(skewed.finalScore);
  });

  it('respects custom weights', () => {
    const words = ['plant'];
    const heavy = scoreBoard(cats4x4, words, {
      weights: { ...DEFAULT_WEIGHTS, playerRelevantWords: 1000 },
    });
    const light = scoreBoard(cats4x4, words, {
      weights: { ...DEFAULT_WEIGHTS, playerRelevantWords: 0 },
    });
    expect(heavy.finalScore).toBeGreaterThan(light.finalScore);
  });
});
