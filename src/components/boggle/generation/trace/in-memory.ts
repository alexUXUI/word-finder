import type {
  GenerationOutcome,
  GenerationTrace,
  Span,
  SpanHandle,
  SpanType,
  TraceHandle,
  Tracer,
} from './types';

let counter = 0;
const id = () => `${Date.now().toString(36)}-${(++counter).toString(36)}`;

class InMemorySpan implements SpanHandle {
  span_id = id();
  parent_span_id: string | null;
  name: string;
  type: SpanType;
  start_ms: number;
  end_ms = 0;
  attributes: Record<string, unknown> = {};
  inputs?: unknown;
  outputs?: unknown;
  error?: { message: string; stack?: string };
  private finished = false;

  constructor(name: string, type: SpanType, parent_span_id: string | null) {
    this.name = name;
    this.type = type;
    this.parent_span_id = parent_span_id;
    this.start_ms = performance.now();
  }
  setAttribute(key: string, value: unknown) {
    this.attributes[key] = value;
  }
  setInputs(v: unknown) {
    this.inputs = v;
  }
  setOutputs(v: unknown) {
    this.outputs = v;
  }
  recordError(err: { message: string; stack?: string }) {
    this.error = err;
  }
  end() {
    if (this.finished) return;
    this.finished = true;
    this.end_ms = performance.now();
  }
  toSpan(): Span {
    return {
      span_id: this.span_id,
      parent_span_id: this.parent_span_id,
      name: this.name,
      type: this.type,
      start_ms: this.start_ms,
      end_ms: this.end_ms || performance.now(),
      attributes: { ...this.attributes },
      inputs: this.inputs,
      outputs: this.outputs,
      error: this.error,
    };
  }
}

class InMemoryTraceHandle implements TraceHandle {
  trace_id = id();
  spans: InMemorySpan[] = [];
  constructor(
    private readonly meta: Parameters<Tracer['startTrace']>[0],
    private readonly sink: (t: GenerationTrace) => void
  ) {}
  startSpan(name: string, type: SpanType, parent?: SpanHandle): SpanHandle {
    const s = new InMemorySpan(name, type, parent?.span_id ?? null);
    this.spans.push(s);
    return s;
  }
  finish(outcome: GenerationOutcome): GenerationTrace {
    for (const s of this.spans) s.end();
    const trace: GenerationTrace = {
      trace_id: this.trace_id,
      generation_id: this.meta.generation_id,
      goal_signature: this.meta.goal_signature,
      prompt_versions: this.meta.prompt_versions ?? {},
      model_versions: this.meta.model_versions ?? {},
      spans: this.spans.map((s) => s.toSpan()),
      outcome,
      created_at: new Date().toISOString(),
      client: this.meta.client,
    };
    this.sink(trace);
    return trace;
  }
}

/**
 * In-memory tracer — collects traces in an array exposed via `traces`.
 * Use in tests and for offline replay; cheap and deterministic.
 */
export class InMemoryTracer implements Tracer {
  readonly traces: GenerationTrace[] = [];
  startTrace(meta: Parameters<Tracer['startTrace']>[0]): TraceHandle {
    return new InMemoryTraceHandle(meta, (t) => this.traces.push(t));
  }
}
