/**
 * GenerationTrace schema. OpenTelemetry-shaped so we can plug in OTel-compatible
 * sinks later (MLflow, Honeycomb, Tempo, custom). The shapes here are
 * intentionally simple and mirror what AGENTIC_VISION.md §4 specifies.
 *
 * Phase 1: types + console / in-memory / noop adapters.
 * Phase 5: MLflow adapter via a Cloudflare Worker proxy.
 */

export type SpanType =
  | 'AGENT'
  | 'CHAIN'
  | 'CHAT_MODEL'
  | 'TOOL'
  | 'RETRIEVER'
  | 'EVALUATION';

export interface Span {
  span_id: string;
  parent_span_id: string | null;
  name: string;
  type: SpanType;
  start_ms: number;
  end_ms: number;
  attributes: Readonly<Record<string, unknown>>;
  inputs?: unknown;
  outputs?: unknown;
  error?: { message: string; stack?: string };
}

export interface GenerationOutcome {
  final_score: number;
  final_metrics: Readonly<Record<string, unknown>>;
  elapsed_ms: number;
  candidates_evaluated: number;
  model_calls: number;
  estimated_cost_usd: number;
  budget_exhausted: boolean;
  selected_strategy: string;
}

export interface GenerationTrace {
  trace_id: string;
  generation_id: string;
  prompt_versions: Readonly<Record<string, string>>;
  model_versions: Readonly<Record<string, string>>;
  goal_signature: string;
  spans: readonly Span[];
  outcome: GenerationOutcome;
  created_at: string;
  client?: {
    browser?: string;
    webgpu_available?: boolean;
    model_load_ms?: number;
  };
}

export interface SpanHandle {
  readonly span_id: string;
  setAttribute(key: string, value: unknown): void;
  setInputs(inputs: unknown): void;
  setOutputs(outputs: unknown): void;
  recordError(err: { message: string; stack?: string }): void;
  end(): void;
}

export interface TraceHandle {
  readonly trace_id: string;
  startSpan(name: string, type: SpanType, parent?: SpanHandle): SpanHandle;
  finish(outcome: GenerationOutcome): GenerationTrace;
}

export interface Tracer {
  startTrace(meta: {
    generation_id: string;
    goal_signature: string;
    prompt_versions?: Readonly<Record<string, string>>;
    model_versions?: Readonly<Record<string, string>>;
    client?: GenerationTrace['client'];
  }): TraceHandle;
}
