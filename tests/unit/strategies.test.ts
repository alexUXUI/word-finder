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

import {
  getStrategy,
  listStrategies,
  defaultStrategyForLanguage,
} from '../../src/components/boggle/generation/registry';
import { frequencyWeightedStrategy } from '../../src/components/boggle/generation/strategies/frequency-weighted';
import { legacyRussianStrategy } from '../../src/components/boggle/generation/strategies/legacy-russian';
import { Language } from '../../src/components/boggle/models';

describe('strategy registry', () => {
  it('lists registered strategies', () => {
    const names = listStrategies();
    expect(names).toContain('frequency-weighted');
    expect(names).toContain('legacy-russian');
  });

  it('returns undefined for unknown strategy', () => {
    expect(getStrategy('nope')).toBeUndefined();
  });

  it('routes English / Spanish / default to frequency-weighted', () => {
    expect(defaultStrategyForLanguage(Language.English).name).toBe(
      'frequency-weighted'
    );
    expect(defaultStrategyForLanguage(Language.Spanish).name).toBe(
      'frequency-weighted'
    );
    expect(defaultStrategyForLanguage('Klingon').name).toBe(
      'frequency-weighted'
    );
  });

  it('routes Russian to legacy-russian', () => {
    expect(defaultStrategyForLanguage(Language.Russian).name).toBe(
      'legacy-russian'
    );
  });
});

describe('frequency-weighted strategy', () => {
  it('produces a 25-char board for size 5', () => {
    const result = frequencyWeightedStrategy.generate({
      size: 5,
      language: Language.English,
    });
    expect(result.board.length).toBe(25);
  });

  it('returns metadata identifying the strategy', () => {
    const result = frequencyWeightedStrategy.generate({
      size: 4,
      language: Language.English,
    });
    expect(result.strategy).toBe('frequency-weighted');
    expect(result.params).toMatchObject({
      distribution: 'english-letter-frequency',
    });
  });

  it('produces variable boards across calls', () => {
    const boards = new Set<string>();
    for (let i = 0; i < 20; i++) {
      boards.add(
        frequencyWeightedStrategy.generate({
          size: 5,
          language: Language.English,
        }).board
      );
    }
    expect(boards.size).toBeGreaterThan(1);
  });
});

describe('legacy-russian strategy', () => {
  it('produces a board of size² letters', () => {
    const result = legacyRussianStrategy.generate({
      size: 5,
      language: Language.Russian,
    });
    expect(result.board.length).toBe(25);
  });

  it('returns metadata identifying the strategy', () => {
    const result = legacyRussianStrategy.generate({
      size: 4,
      language: Language.Russian,
    });
    expect(result.strategy).toBe('legacy-russian');
  });
});
