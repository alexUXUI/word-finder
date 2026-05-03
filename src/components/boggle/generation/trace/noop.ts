import type {
  GenerationOutcome,
  GenerationTrace,
  Span,
  SpanHandle,
  SpanType,
  TraceHandle,
  Tracer,
} from './types';

const NOOP_SPAN: SpanHandle = Object.freeze({
  span_id: 'noop',
  setAttribute() {},
  setInputs() {},
  setOutputs() {},
  recordError() {},
  end() {},
});

const NOOP_TRACE: TraceHandle = Object.freeze({
  trace_id: 'noop',
  startSpan(_name: string, _type: SpanType, _parent?: SpanHandle): SpanHandle {
    return NOOP_SPAN;
  },
  finish(outcome: GenerationOutcome): GenerationTrace {
    return {
      trace_id: 'noop',
      generation_id: 'noop',
      goal_signature: 'noop',
      prompt_versions: {},
      model_versions: {},
      spans: [] as Span[],
      outcome,
      created_at: new Date().toISOString(),
    };
  },
});

/**
 * Default no-op tracer — zero overhead, zero output. Used when a caller does
 * not opt into tracing.
 */
export const NoopTracer: Tracer = Object.freeze({
  startTrace() {
    return NOOP_TRACE;
  },
});
