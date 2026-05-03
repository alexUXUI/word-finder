import { InMemoryTracer } from './in-memory';
import type { GenerationTrace, Tracer, TraceHandle } from './types';

const oneLine = (t: GenerationTrace) => {
  const total = t.spans.reduce((s, sp) => s + (sp.end_ms - sp.start_ms), 0);
  return `[trace ${t.trace_id}] goal=${t.goal_signature} score=${t.outcome.final_score.toFixed(1)} cands=${t.outcome.candidates_evaluated} elapsed=${t.outcome.elapsed_ms.toFixed(0)}ms span_total=${total.toFixed(0)}ms strategy=${t.outcome.selected_strategy}${t.outcome.budget_exhausted ? ' (budget)' : ''}`;
};

/**
 * Console tracer — pretty-prints a one-liner per finished trace.
 * Useful in dev and for the `yarn eval` runner.
 */
export class ConsoleTracer implements Tracer {
  private readonly inner = new InMemoryTracer();
  startTrace(meta: Parameters<Tracer['startTrace']>[0]): TraceHandle {
    const handle = this.inner.startTrace(meta);
    const originalFinish = handle.finish.bind(handle);
    handle.finish = (outcome) => {
      const trace = originalFinish(outcome);
      // eslint-disable-next-line no-console
      console.log(oneLine(trace));
      return trace;
    };
    return handle;
  }
  get traces(): readonly GenerationTrace[] {
    return this.inner.traces;
  }
}
