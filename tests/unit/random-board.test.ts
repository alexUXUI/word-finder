import { describe, it, expect, vi } from 'vitest';

vi.mock('@builder.io/qwik', () => ({
  $: <T,>(fn: T) => fn,
}));
vi.mock('tone', () => ({
  MonoSynth: class {
    toDestination() { return this; }
    triggerAttackRelease() {}
  },
  now: () => 0,
}));
vi.mock('../../src/components/boggle/logic/confetti', () => ({
  fireworks: () => {},
}));

import {
  randomBoard,
  ENGLISH_LETTER_FREQUENCY,
  russianVowels,
  russianConsonants,
  russianUnpopularConsonants,
  calculateCellWidth,
} from '../../src/components/boggle/logic/board';

const SIZES = [3, 4, 5, 6, 7];

describe('randomBoard(language, size)', () => {
  it.each(SIZES)('returns size² letters for size %i (English)', (size) => {
    expect(randomBoard('English', size).length).toBe(size * size);
  });

  it.each(SIZES)('returns size² letters for size %i (Russian)', (size) => {
    expect(randomBoard('Russian', size).length).toBe(size * size);
  });

  it('uses only letters from the English frequency table when language=English', () => {
    const englishPool = new Set(Object.keys(ENGLISH_LETTER_FREQUENCY));
    for (let trial = 0; trial < 20; trial++) {
      const result = randomBoard('English', 5);
      for (const ch of result) {
        expect(englishPool.has(ch), `unexpected English letter: ${ch}`).toBe(true);
      }
    }
  });

  it('produces variable vowel inventories across calls (the Phase 0 finding)', () => {
    // The previous algorithm had a static vowel multiset (always 5e/3a/2i,
    // never o or u). Frequency-weighted sampling should break that.
    const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
    const multisets = new Set<string>();
    let sawO = false;
    let sawU = false;
    for (let trial = 0; trial < 30; trial++) {
      const board = randomBoard('English', 5);
      const vowelChars = [...board].filter((c) => VOWELS.has(c)).sort().join('');
      multisets.add(vowelChars);
      if (board.includes('o')) sawO = true;
      if (board.includes('u')) sawU = true;
    }
    expect(multisets.size).toBeGreaterThan(5);
    expect(sawO).toBe(true);
    expect(sawU).toBe(true);
  });

  it('uses only the Russian language pool when language=Russian', () => {
    const russianPool = new Set([
      ...russianVowels,
      ...russianConsonants,
      ...russianUnpopularConsonants,
    ]);
    for (let trial = 0; trial < 20; trial++) {
      const result = randomBoard('Russian', 5);
      for (const ch of result) {
        expect(russianPool.has(ch), `unexpected Russian letter: ${ch}`).toBe(true);
      }
    }
  });

  it('produces variability across calls (Math.random)', () => {
    // 50 boards, expect more than one unique permutation. Astronomically
    // small chance of false flake on a 5×5 random board.
    const samples = new Set<string>();
    for (let i = 0; i < 50; i++) samples.add(randomBoard('English', 5));
    expect(samples.size).toBeGreaterThan(1);
  });

  it('falls back to English pool for unknown languages', () => {
    const englishPool = new Set(Object.keys(ENGLISH_LETTER_FREQUENCY));
    const result = randomBoard('Klingon', 4);
    for (const ch of result) {
      expect(englishPool.has(ch)).toBe(true);
    }
  });
});

describe('calculateCellWidth(boardWidth, boardSize)', () => {
  it('returns a positive width for every supported size', () => {
    for (const size of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const w = calculateCellWidth(400, size);
      expect(w).toBeGreaterThan(0);
    }
  });

  it('shrinks the cell as boardSize grows on a fixed boardWidth', () => {
    let prev = Infinity;
    for (const size of [3, 4, 5, 6, 7]) {
      const w = calculateCellWidth(400, size);
      expect(w).toBeLessThan(prev);
      prev = w;
    }
  });
});
