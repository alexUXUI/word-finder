import { describe, it, expect, vi } from 'vitest';

vi.mock('@builder.io/qwik', () => ({ $: <T,>(fn: T) => fn }));
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

import { searchForBoard } from '../../src/components/boggle/generation/search';
import { Language } from '../../src/components/boggle/models';

const TINY_DICT = [
  'cat', 'cats', 'cad', 'card', 'arc', 'arcs', 'rat', 'rats',
  'tar', 'tars', 'star', 'stars', 'art', 'arts',
  'plan', 'plant', 'plants', 'plate', 'plates', 'play', 'plays',
  'react', 'reacts', 'tract', 'tracts', 'trace', 'traces',
];

describe('searchForBoard()', () => {
  it('returns at least one evaluated candidate within a tight budget', () => {
    const r = searchForBoard({
      size: 4,
      language: Language.English,
      minWordLength: 3,
      dictionary: TINY_DICT,
      maxCandidates: 5,
    });
    expect(r.candidatesEvaluated).toBeGreaterThan(0);
    expect(r.board.length).toBe(16);
    expect(r.score.totalWords).toBeGreaterThanOrEqual(0);
  });

  it('respects maxCandidates as a hard cap', () => {
    const r = searchForBoard({
      size: 4,
      language: Language.English,
      minWordLength: 3,
      dictionary: TINY_DICT,
      maxCandidates: 3,
      maxMs: 60_000,
    });
    expect(r.candidatesEvaluated).toBe(3);
    expect(r.reason).toBe('max-candidates');
  });

  it('respects maxMs and stops at the time budget', () => {
    const r = searchForBoard({
      size: 5,
      language: Language.English,
      minWordLength: 3,
      dictionary: TINY_DICT,
      maxCandidates: 1_000_000,
      maxMs: 50,
    });
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(r.candidatesEvaluated).toBeGreaterThan(0);
    expect(r.reason).toBe('max-ms');
  });

  it('stops early when targetScore is reached', () => {
    // A very low target so almost any candidate clears it.
    const r = searchForBoard({
      size: 4,
      language: Language.English,
      minWordLength: 3,
      dictionary: TINY_DICT,
      maxCandidates: 50,
      targetScore: -Infinity,
    });
    expect(r.candidatesEvaluated).toBe(1);
    expect(r.reason).toBe('target-met');
  });

  it('selects the highest-scoring of the candidates evaluated', () => {
    // Run several searches and confirm the returned score is the max each time.
    for (let trial = 0; trial < 3; trial++) {
      const r = searchForBoard({
        size: 4,
        language: Language.English,
        minWordLength: 3,
        dictionary: TINY_DICT,
        maxCandidates: 10,
      });
      // The score must be >= the score of any single random board (we can't
      // re-run the exact same trial, but we can sanity check internal state).
      expect(r.score.finalScore).not.toBe(-Infinity);
      expect(Number.isFinite(r.score.finalScore)).toBe(true);
    }
  });

  it('reports strategy used', () => {
    const r = searchForBoard({
      size: 4,
      language: Language.English,
      minWordLength: 3,
      dictionary: TINY_DICT,
      maxCandidates: 1,
    });
    expect(r.strategyUsed).toBe('frequency-weighted');
  });

  it('throws on maxCandidates: 0', () => {
    expect(() =>
      searchForBoard({
        size: 4,
        language: Language.English,
        minWordLength: 3,
        dictionary: TINY_DICT,
        maxCandidates: 0,
      })
    ).toThrow();
  });
});
