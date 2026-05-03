/**
 * MLflow trace adapter. POSTs the GenerationTrace JSON to the local mlflow
 * proxy (`tools/mlflow-proxy/server.py`), which uses the mlflow Python SDK
 * to replay spans into MLflow as native traces.
 *
 * Why a proxy:
 * - Browser CORS blocks direct POST to MLflow.
 * - MLflow's OTLP /v1/traces only accepts protobuf, not JSON.
 *
 * Default endpoint: http://localhost:5001/traces (the proxy).
 * Override via `endpoint` option or MLFLOW_PROXY_ENDPOINT env var.
 */
import { InMemoryTracer } from './in-memory';
import type {
  GenerationTrace,
  Tracer,
  TraceHandle,
} from './types';

export interface MLflowTracerOptions {
  endpoint?: string;
  experimentName?: string;
  /** Suppress export errors (default: log to console.warn). */
  silent?: boolean;
}

const DEFAULT_ENDPOINT =
  (typeof process !== 'undefined' && process.env?.MLFLOW_PROXY_ENDPOINT) ||
  'http://localhost:5001/traces';

export class MLflowTracer implements Tracer {
  private readonly inner = new InMemoryTracer();
  private readonly endpoint: string;
  private readonly experimentName: string;
  private readonly silent: boolean;
  private readonly inflight: Set<Promise<unknown>> = new Set();

  constructor(options: MLflowTracerOptions = {}) {
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.experimentName = options.experimentName ?? 'word-finder';
    this.silent = options.silent ?? false;
  }

  startTrace(meta: Parameters<Tracer['startTrace']>[0]): TraceHandle {
    const handle = this.inner.startTrace(meta);
    const originalFinish = handle.finish.bind(handle);
    handle.finish = (outcome) => {
      const trace = originalFinish(outcome);
      const promise = this.export(trace)
        .catch((err) => {
          if (!this.silent) {
            // eslint-disable-next-line no-console
            console.warn(
              `[MLflowTracer] export failed (${this.endpoint}):`,
              err.message ?? err
            );
          }
        })
        .finally(() => {
          this.inflight.delete(promise);
        });
      this.inflight.add(promise);
      return trace;
    };
    return handle;
  }

  /**
   * Wait for all in-flight exports to complete. Call before exiting tests
   * or short-lived processes so traces aren't lost.
   */
  async flush(): Promise<void> {
    await Promise.all([...this.inflight]);
  }

  /** Exposed for tests. */
  async export(trace: GenerationTrace): Promise<void> {
    const body = JSON.stringify({
      experiment_name: this.experimentName,
      trace,
    });
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `MLflow proxy ${this.endpoint} returned ${res.status} ${res.statusText}: ${text}`
      );
    }
  }

  get traces(): readonly GenerationTrace[] {
    return this.inner.traces;
  }
}
