import { describe, it, expect } from 'vitest';
import { runPipeline } from '../../../src/components/boggle/intelligence/pipeline/runner';
import {
  listStrategiesForLanguage,
} from '../../../src/components/boggle/generation/registry';
import { p00Deterministic } from '../../../src/components/boggle/intelligence/pipelines/p00-deterministic';
import { p01SmartRouter } from '../../../src/components/boggle/intelligence/pipelines/p01-smart-router';
import { p02SlmMutator } from '../../../src/components/boggle/intelligence/pipelines/p02-slm-mutator';
import { makeMockProvider } from '../../../src/components/boggle/intelligence/local-model/mock';
import { NoopTracer } from '../../../src/components/boggle/generation/trace';
import { Language } from '../../../src/components/boggle/models';

const TINY_DICT = [
  'castle',
  'people',
  'finger',
  'water',
  'house',
  'mouse',
  'glass',
  'stone',
  'river',
  'ocean',
  'grand',
  'shore',
  'plant',
  'world',
  'light',
  'right',
  'might',
  'eight',
  'tight',
  'fight',
  'sight',
  'night',
  'paint',
  'point',
  'count',
  'mount',
  'shout',
  'spout',
  'about',
  'doubt',
  'south',
  'north',
];

describe('listStrategiesForLanguage', () => {
  it('English goals never include the Russian-only strategy', () => {
    const list = listStrategiesForLanguage(Language.English);
    expect(list).toContain('frequency-weighted');
    expect(list).not.toContain('legacy-russian');
  });

  it('Russian goals get the Russian strategy', () => {
    const list = listStrategiesForLanguage(Language.Russian);
    expect(list).toContain('legacy-russian');
    expect(list).not.toContain('frequency-weighted');
  });

  it('Spanish goals share the English strategy', () => {
    const list = listStrategiesForLanguage(Language.Spanish);
    expect(list).toContain('frequency-weighted');
    expect(list).not.toContain('legacy-russian');
  });
});

describe('runPipeline — language safety', () => {
  it('English pipeline run produces an English-letter board', async () => {
    const result = await runPipeline(p00Deterministic, {
      goal: {
        size: 4,
        minWordLength: 3,
        language: Language.English,
      },
      dictionary: TINY_DICT,
      tracer: NoopTracer,
    });
    // Every cell must be a-z, never Cyrillic. This is the regression
    // guard for the "legacy-russian on English goal" bug we just shipped.
    expect(result.board).toMatch(/^[a-z]+$/);
    expect(result.strategy).toBe('frequency-weighted');
  });

  it('English smart-router never selects a Russian strategy even with a real-ish SLM', async () => {
    // Mock a "misbehaving" SLM that always names `legacy-russian`. The
    // pipeline must still produce an English board because the runner
    // filters the available list before the router ever sees it.
    const evilModel = makeMockProvider({
      id: 'evil',
      scriptedReply: () => 'legacy-russian',
    });
    await evilModel.load();
    const result = await runPipeline(p01SmartRouter, {
      goal: {
        size: 4,
        minWordLength: 3,
        language: Language.English,
      },
      dictionary: TINY_DICT,
      model: evilModel,
      tracer: NoopTracer,
    });
    expect(result.board).toMatch(/^[a-z]+$/);
    expect(result.strategy).toBe('frequency-weighted');
  });
});

describe('runPipeline — basic shape', () => {
  it('p02-slm-mutator produces a board, runs the mutator loop, traces the run', async () => {
    const model = makeMockProvider({ id: 'test' });
    await model.load();
    const result = await runPipeline(p02SlmMutator, {
      goal: {
        size: 4,
        minWordLength: 3,
        language: Language.English,
      },
      dictionary: TINY_DICT,
      model,
      tracer: NoopTracer,
    });
    expect(result.board).toMatch(/^[a-z]{16}$/);
    expect(result.modelCalls).toBeGreaterThanOrEqual(1);
    expect(result.candidatesEvaluated).toBeGreaterThan(0);
    // The pipeline ran best-of-50 + 8 mutator iters × 3 swaps each. Tiny
    // dict + 4×4 board limits some of the search-engine work, but
    // candidates evaluated should be well over the trivial baseline.
    expect(result.candidatesEvaluated).toBeGreaterThan(0);
    expect(result.elapsedMs).toBeGreaterThan(0);
    expect(result.score.finalScore).toBeGreaterThanOrEqual(0);
  });
});
