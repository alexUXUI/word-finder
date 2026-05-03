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
  InMemoryTracer,
  NoopTracer,
} from '../../src/components/boggle/generation/trace';
import { searchForBoard } from '../../src/components/boggle/generation/search';
import { Language } from '../../src/components/boggle/models';

const TINY_DICT = ['cat', 'cats', 'plant', 'plants', 'react', 'reacts'];

describe('InMemoryTracer', () => {
  it('records a trace when finish() is called', () => {
    const tracer = new InMemoryTracer();
    const handle = tracer.startTrace({
      generation_id: 'g1',
      goal_signature: 'test',
    });
    const span = handle.startSpan('a', 'TOOL');
    span.setAttribute('k', 1);
    span.end();
    handle.finish({
      final_score: 42,
      final_metrics: {},
      elapsed_ms: 10,
      candidates_evaluated: 1,
      model_calls: 0,
      estimated_cost_usd: 0,
      budget_exhausted: false,
      selected_strategy: 'test',
    });
    expect(tracer.traces).toHaveLength(1);
    expect(tracer.traces[0].generation_id).toBe('g1');
    expect(tracer.traces[0].spans).toHaveLength(1);
    expect(tracer.traces[0].spans[0].attributes).toMatchObject({ k: 1 });
    expect(tracer.traces[0].outcome.final_score).toBe(42);
  });
});

describe('NoopTracer', () => {
  it('produces no spans and zero overhead', () => {
    const handle = NoopTracer.startTrace({
      generation_id: 'g',
      goal_signature: 't',
    });
    const span = handle.startSpan('x', 'TOOL');
    span.setAttribute('a', 1);
    span.end();
    const trace = handle.finish({
      final_score: 0,
      final_metrics: {},
      elapsed_ms: 0,
      candidates_evaluated: 0,
      model_calls: 0,
      estimated_cost_usd: 0,
      budget_exhausted: false,
      selected_strategy: 'noop',
    });
    expect(trace.spans).toHaveLength(0);
  });
});

describe('searchForBoard with tracer', () => {
  it('emits a TOOL span with strategy and candidate count', () => {
    const tracer = new InMemoryTracer();
    const r = searchForBoard({
      size: 4,
      language: Language.English,
      minWordLength: 3,
      dictionary: TINY_DICT,
      maxCandidates: 5,
      tracer,
      goalSignature: 'unit-test',
    });
    expect(tracer.traces).toHaveLength(1);
    const t = tracer.traces[0];
    expect(t.goal_signature).toBe('unit-test');
    // Root span + per-candidate spans (each with 3 children: generate / solve / score).
    // 5 candidates → 1 + 5 × (1 + 3) = 21 spans.
    expect(t.spans.length).toBeGreaterThan(1);
    const root = t.spans.find((s) => s.name === 'search.best-of-n');
    expect(root).toBeDefined();
    expect(root!.type).toBe('TOOL');
    expect(root!.attributes).toMatchObject({
      strategy: 'frequency-weighted',
      max_candidates: 5,
      candidates_evaluated: 5,
    });
    // Per-candidate detail.
    const candidateSpans = t.spans.filter((s) => s.name.startsWith('candidate.'));
    expect(candidateSpans).toHaveLength(5);
    expect(t.spans.some((s) => s.name === 'tool.generate')).toBe(true);
    expect(t.spans.some((s) => s.name === 'tool.solve')).toBe(true);
    expect(t.spans.some((s) => s.name === 'tool.score')).toBe(true);
    expect(t.outcome.selected_strategy).toBe('frequency-weighted');
    expect(r.trace).toBe(t);
  });

  it('returns no trace when no tracer is provided', () => {
    const r = searchForBoard({
      size: 4,
      language: Language.English,
      minWordLength: 3,
      dictionary: TINY_DICT,
      maxCandidates: 1,
    });
    expect(r.trace).toBeUndefined();
  });
});
