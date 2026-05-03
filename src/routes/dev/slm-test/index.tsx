import {
  component$,
  useSignal,
  useStore,
  $,
  noSerialize,
} from '@builder.io/qwik';
import type { NoSerialize } from '@builder.io/qwik';
import type { DocumentHead } from '@builder.io/qwik-city';

export const head: DocumentHead = {
  title: 'SLM Test',
};

interface ProgressEntry {
  file: string;
  loaded: number;
  total?: number;
  status: string;
  ts: number;
}

interface State {
  status: 'idle' | 'loading' | 'ready' | 'generating' | 'error';
  errorMessage?: string;
  modelId: string;
  prompt: string;
  output?: string;
  loadElapsedMs?: number;
  generateElapsedMs?: number;
  spanExport?: 'idle' | 'sending' | 'sent' | 'failed';
  spanError?: string;
  progress: ProgressEntry[];
}

export default component$(() => {
  // noSerialize because TransformersJsProvider holds an ONNX runtime
  // generator instance and other non-serializable internals — Qwik's
  // resumability would otherwise try to JSON-stringify it on signal change.
  const providerRef = useSignal<NoSerialize<unknown>>();
  const state = useStore<State>({
    status: 'idle',
    modelId: 'onnx-community/Qwen2.5-0.5B-Instruct',
    prompt:
      'You are a Boggle expert. Reply with one short sentence: which letters tend to produce the most 5+ letter words on a 5x5 board?',
    progress: [],
    spanExport: 'idle',
  });

  const loadModel = $(async () => {
    state.status = 'loading';
    state.errorMessage = undefined;
    state.progress = [];
    const t0 = performance.now();
    try {
      const { TransformersJsProvider } = await import(
        '~/components/boggle/intelligence/local-model'
      );
      const provider = new TransformersJsProvider({ modelId: state.modelId });
      providerRef.value = noSerialize(provider);
      await provider.load((p) => {
        state.progress = [
          ...state.progress.slice(-19),
          { ...p, ts: performance.now() },
        ];
      });
      state.loadElapsedMs = performance.now() - t0;
      state.status = 'ready';
    } catch (err) {
      state.errorMessage = err instanceof Error ? err.message : String(err);
      state.status = 'error';
    }
  });

  const runGenerate = $(async () => {
    if (!providerRef.value) return;
    state.status = 'generating';
    state.errorMessage = undefined;
    state.output = undefined;
    state.spanExport = 'idle';
    const t0 = performance.now();
    try {
      const provider = providerRef.value as unknown as {
        generate: (req: {
          messages: { role: string; content: string }[];
          maxTokens?: number;
          temperature?: number;
        }) => Promise<{ text: string; elapsedMs: number }>;
      };
      const out = await provider.generate({
        messages: [
          { role: 'system', content: 'You are concise.' },
          { role: 'user', content: state.prompt },
        ],
        maxTokens: 128,
        temperature: 0.3,
      });
      state.output = out.text;
      state.generateElapsedMs = out.elapsedMs;
      state.status = 'ready';

      // Build a minimal trace and POST it to the MLflow proxy.
      // Keeps Phase 2.0a's trace pipeline live during this manual test —
      // proves real SLM calls produce CHAT_MODEL spans visible in MLflow.
      state.spanExport = 'sending';
      try {
        const tNow = performance.now();
        const traceStart = tNow - out.elapsedMs - (state.loadElapsedMs ?? 0);
        const trace = {
          trace_id: `slm-test-${Date.now()}`,
          generation_id: `slm-test-${Date.now()}`,
          goal_signature: 'slm-test',
          prompt_versions: {},
          model_versions: { orchestrator: state.modelId },
          spans: [
            {
              span_id: 'agent-root',
              parent_span_id: null,
              name: 'agent.slm-test',
              type: 'AGENT' as const,
              start_ms: traceStart,
              end_ms: tNow,
              attributes: { model_id: state.modelId },
            },
            {
              span_id: 'load',
              parent_span_id: 'agent-root',
              name: 'model.load',
              type: 'TOOL' as const,
              start_ms: traceStart,
              end_ms: traceStart + (state.loadElapsedMs ?? 0),
              attributes: {
                model_id: state.modelId,
                load_elapsed_ms: state.loadElapsedMs ?? 0,
              },
            },
            {
              span_id: 'generate',
              parent_span_id: 'agent-root',
              name: 'model.generate',
              type: 'CHAT_MODEL' as const,
              start_ms: tNow - out.elapsedMs,
              end_ms: tNow,
              attributes: {
                model_id: state.modelId,
                temperature: 0.3,
                max_tokens: 128,
                output_chars: out.text.length,
              },
              inputs: { messages: [{ role: 'user', content: state.prompt }] },
              outputs: { text: out.text },
            },
          ],
          outcome: {
            final_score: 0,
            final_metrics: { generate_elapsed_ms: out.elapsedMs },
            elapsed_ms: out.elapsedMs,
            candidates_evaluated: 1,
            model_calls: 1,
            estimated_cost_usd: 0,
            budget_exhausted: false,
            selected_strategy: 'slm-test',
          },
          created_at: new Date().toISOString(),
        };
        const proxyUrl =
          (typeof window !== 'undefined' &&
            (window as unknown as { __MLFLOW_PROXY__?: string }).__MLFLOW_PROXY__) ||
          'http://localhost:5001/traces';
        const res = await fetch(proxyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            experiment_name: 'word-finder-slm-test',
            trace,
          }),
        });
        if (!res.ok) {
          throw new Error(`proxy returned ${res.status} ${res.statusText}`);
        }
        state.spanExport = 'sent';
      } catch (err) {
        state.spanExport = 'failed';
        state.spanError = err instanceof Error ? err.message : String(err);
      }
    } catch (err) {
      state.errorMessage = err instanceof Error ? err.message : String(err);
      state.status = 'error';
      void t0;
    }
  });

  return (
    <div style="padding: 16px; font-family: system-ui, sans-serif; max-width: 720px;">
      <h1 data-testid="slm-test-title">SLM Test — Real model, real traces</h1>
      <p style="color:#555">
        Loads <code>{state.modelId}</code> in the browser via Transformers.js,
        runs one generation, and POSTs a trace to the MLflow proxy at
        <code> http://localhost:5001/traces</code>.
      </p>
      <div style="margin: 16px 0;">
        <button
          data-testid="load-model"
          disabled={state.status === 'loading' || state.status === 'generating'}
          onClick$={loadModel}
        >
          {state.status === 'loading'
            ? 'Loading…'
            : state.status === 'ready'
            ? 'Reload model'
            : 'Load model'}
        </button>{' '}
        <button
          data-testid="run-generate"
          disabled={state.status !== 'ready'}
          onClick$={runGenerate}
        >
          {state.status === 'generating' ? 'Generating…' : 'Run generate'}
        </button>
      </div>
      <div data-testid="state-status">Status: {state.status}</div>
      {state.loadElapsedMs !== undefined && (
        <div data-testid="load-elapsed">
          Model load: {Math.round(state.loadElapsedMs)} ms
        </div>
      )}
      {state.generateElapsedMs !== undefined && (
        <div data-testid="generate-elapsed">
          Generate: {Math.round(state.generateElapsedMs)} ms
        </div>
      )}
      {state.spanExport !== 'idle' && (
        <div data-testid="span-export">Trace export: {state.spanExport}</div>
      )}
      {state.spanError && (
        <div data-testid="span-error" style="color:#a00">
          Trace export error: {state.spanError}
        </div>
      )}
      {state.errorMessage && (
        <div data-testid="error" style="color:#a00; margin-top: 12px;">
          Error: {state.errorMessage}
        </div>
      )}
      {state.output !== undefined && (
        <div style="margin-top: 12px;">
          <strong>Output:</strong>
          <pre data-testid="output" style="white-space: pre-wrap; background:#f4f4f4; padding:8px; border-radius:4px;">
            {state.output}
          </pre>
        </div>
      )}
      <div style="margin-top: 24px;">
        <strong>Progress:</strong>
        <ul
          data-testid="progress-log"
          style="font-family: monospace; font-size: 12px; max-height: 240px; overflow:auto;"
        >
          {state.progress.map((p, i) => (
            <li key={i}>
              {p.status} — {p.file}
              {p.total ? ` (${p.loaded}/${p.total})` : ''}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
});
