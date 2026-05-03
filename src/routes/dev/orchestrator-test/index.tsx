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
  title: 'Orchestrator Test',
};

interface State {
  status: 'idle' | 'loading-model' | 'fetching-dict' | 'ready' | 'generating' | 'error';
  errorMessage?: string;
  modelId: string;
  style: 'balanced' | 'long-word-heavy' | 'classic' | 'rare-letter' | 'chaotic';
  size: number;
  minWordLength: number;
  result?: {
    board: string;
    playerRelevantWords: number;
    maxWordLength: number;
    finalScore: number;
    strategyChosen: string;
    explanation: string;
    modelCalls: number;
    elapsedMs: number;
  };
  spanExport?: 'idle' | 'sending' | 'sent' | 'failed';
  spanError?: string;
  modelLoadMs?: number;
  dictSize?: number;
  log: string[];
}

export default component$(() => {
  // Heavy refs are noSerialize'd — Qwik can't JSON-stringify them.
  const providerRef = useSignal<NoSerialize<unknown>>();
  const dictRef = useSignal<NoSerialize<string[]>>();
  const tracerRef = useSignal<NoSerialize<unknown>>();

  const state = useStore<State>({
    status: 'idle',
    modelId: 'onnx-community/Qwen2.5-0.5B-Instruct',
    style: 'long-word-heavy',
    size: 5,
    minWordLength: 5,
    log: [],
    spanExport: 'idle',
  });

  const log = $((line: string) => {
    state.log = [...state.log.slice(-20), `[${new Date().toLocaleTimeString()}] ${line}`];
  });

  const loadModel = $(async () => {
    state.status = 'loading-model';
    state.errorMessage = undefined;
    const t0 = performance.now();
    log('loading model…');
    try {
      const { TransformersJsProvider } = await import(
        '~/components/boggle/intelligence/local-model'
      );
      const provider = new TransformersJsProvider({ modelId: state.modelId });
      providerRef.value = noSerialize(provider);
      await provider.load((p) => {
        if (p.status === 'progress' && p.total && p.loaded) {
          const pct = Math.floor((p.loaded / p.total) * 100);
          if (pct % 20 === 0) log(`  ${p.file}: ${pct}%`);
        } else if (p.status !== 'progress') {
          log(`  ${p.status} — ${p.file}`);
        }
      });
      state.modelLoadMs = performance.now() - t0;
      log(`model ready in ${Math.round(state.modelLoadMs)}ms`);

      // Build the MLflow tracer (browser → proxy → MLflow at localhost:5000).
      const { MLflowTracer } = await import(
        '~/components/boggle/generation/trace'
      );
      tracerRef.value = noSerialize(
        new MLflowTracer({
          experimentName: 'word-finder-orchestrator',
          endpoint: 'http://localhost:5001/traces',
        })
      );
      log('mlflow tracer ready (proxy: http://localhost:5001/traces)');

      // Fetch dictionary.
      state.status = 'fetching-dict';
      log('fetching dictionary…');
      const r = await fetch('https://boggle.pages.dev/engmix.txt');
      const text = await r.text();
      const dict = text
        .replace(/(\r\n|\n|\r)/gm, ' ')
        .split(' ')
        .map((w) => w.trim())
        .filter((w) => w.length > 0);
      dictRef.value = noSerialize(dict);
      state.dictSize = dict.length;
      log(`dictionary loaded: ${dict.length} words`);

      state.status = 'ready';
    } catch (err) {
      state.status = 'error';
      state.errorMessage = err instanceof Error ? err.message : String(err);
      log(`ERROR: ${state.errorMessage}`);
    }
  });

  const runOrchestrator = $(async () => {
    if (!providerRef.value || !dictRef.value || !tracerRef.value) {
      state.errorMessage = 'Load model first';
      return;
    }
    state.status = 'generating';
    state.errorMessage = undefined;
    state.spanExport = 'idle';
    state.result = undefined;
    log(`orchestrator start (style=${state.style})…`);
    try {
      const { Orchestrator } = await import(
        '~/components/boggle/intelligence/orchestrator'
      );
      const orchestrator = new Orchestrator({
        model: providerRef.value as unknown as import('~/components/boggle/intelligence/local-model').LocalModelProvider,
        tracer: tracerRef.value as unknown as import('~/components/boggle/generation/trace').Tracer,
        tools: {
          availableStrategies: ['frequency-weighted'],
        },
        budget: { maxCandidates: 75, maxSearchMs: 5000 },
      });
      const result = await orchestrator.generateBoard(
        {
          size: state.size,
          minWordLength: state.minWordLength,
          style: state.style,
          difficulty: 'medium',
        },
        dictRef.value as unknown as string[]
      );
      state.result = {
        board: result.board,
        playerRelevantWords: result.score.playerRelevantWords,
        maxWordLength: result.score.maxWordLength,
        finalScore: result.score.finalScore,
        strategyChosen: result.strategyChosen,
        explanation: result.explanation,
        modelCalls: result.modelCalls,
        elapsedMs: result.elapsedMs,
      };
      log(
        `orchestrator done: strategy=${result.strategyChosen} score=${result.score.finalScore.toFixed(1)} ${result.modelCalls} model calls in ${Math.round(result.elapsedMs)}ms`
      );

      // Trace flush — wait for the MLflow POST to finish so we can verify it.
      state.spanExport = 'sending';
      const tracer = tracerRef.value as unknown as { flush: () => Promise<void> };
      try {
        await tracer.flush();
        state.spanExport = 'sent';
        log('mlflow trace flushed');
      } catch (err) {
        state.spanExport = 'failed';
        state.spanError = err instanceof Error ? err.message : String(err);
        log(`trace export FAILED: ${state.spanError}`);
      }
      state.status = 'ready';
    } catch (err) {
      state.status = 'error';
      state.errorMessage = err instanceof Error ? err.message : String(err);
      log(`ERROR: ${state.errorMessage}`);
    }
  });

  const renderBoard = (board: string, size: number) => {
    const cells = [...board.toUpperCase()];
    return (
      <table data-testid="generated-board" style="border-collapse: collapse; margin: 8px 0;">
        <tbody>
          {Array.from({ length: size }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: size }, (_, c) => (
                <td
                  key={c}
                  style="border:1px solid #888; width:32px; height:32px; text-align:center; font-family:monospace; font-weight:bold;"
                >
                  {cells[r * size + c]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <div style="padding:16px; font-family: system-ui, sans-serif; max-width: 760px;">
      <h1 data-testid="orchestrator-title">Orchestrator Test — full intelligent pipeline</h1>
      <p style="color:#555">
        Runs the SLM-driven board orchestrator end-to-end. Loads
        Qwen2.5-0.5B in the browser, lets it pick a strategy, runs the
        deterministic search engine, then has the SLM explain the result.
        Trace flows live to MLflow at <code>localhost:5000</code>.
      </p>

      <div style="display:flex; gap:8px; align-items:center; margin: 16px 0;">
        <button
          data-testid="load-model"
          disabled={state.status !== 'idle' && state.status !== 'error'}
          onClick$={loadModel}
        >
          {state.status === 'loading-model'
            ? 'Loading model…'
            : state.status === 'fetching-dict'
            ? 'Fetching dictionary…'
            : 'Load model + dictionary'}
        </button>
        <button
          data-testid="run-orchestrator"
          disabled={state.status !== 'ready'}
          onClick$={runOrchestrator}
        >
          {state.status === 'generating' ? 'Generating…' : 'Generate intelligent board'}
        </button>
        <select
          data-testid="style-select"
          value={state.style}
          onChange$={(_, el) => (state.style = el.value as State['style'])}
        >
          <option value="balanced">balanced</option>
          <option value="long-word-heavy">long-word-heavy</option>
          <option value="classic">classic</option>
          <option value="rare-letter">rare-letter</option>
          <option value="chaotic">chaotic</option>
        </select>
      </div>

      <div data-testid="state-status">Status: {state.status}</div>
      {state.modelLoadMs !== undefined && (
        <div data-testid="model-load">Model load: {Math.round(state.modelLoadMs)} ms</div>
      )}
      {state.dictSize !== undefined && (
        <div data-testid="dict-size">Dictionary: {state.dictSize} words</div>
      )}
      {state.spanExport !== 'idle' && (
        <div data-testid="span-export">Trace export: {state.spanExport}</div>
      )}
      {state.errorMessage && (
        <div data-testid="error" style="color:#a00; margin-top:12px;">
          Error: {state.errorMessage}
        </div>
      )}

      {state.result && (
        <div data-testid="result-block" style="margin-top:20px; border-top:1px solid #ddd; padding-top:16px;">
          <h2>Generated board</h2>
          {renderBoard(state.result.board, state.size)}
          <div data-testid="result-strategy">Strategy chosen by SLM: <code>{state.result.strategyChosen}</code></div>
          <div data-testid="result-words">{state.result.playerRelevantWords} words ≥{state.minWordLength} letters; longest = {state.result.maxWordLength}</div>
          <div data-testid="result-score">Final score: {state.result.finalScore.toFixed(2)}</div>
          <div data-testid="result-meta">{state.result.modelCalls} model calls, {Math.round(state.result.elapsedMs)} ms total</div>
          <div style="margin-top:8px;">
            <strong>SLM explanation:</strong>
            <blockquote
              data-testid="result-explanation"
              style="margin: 8px 0; padding: 8px 12px; background:#f8f8ff; border-left:4px solid #339; font-style:italic;"
            >
              {state.result.explanation}
            </blockquote>
          </div>
        </div>
      )}

      <div style="margin-top: 24px;">
        <strong>Log:</strong>
        <ul
          data-testid="log"
          style="font-family: monospace; font-size: 12px; max-height: 280px; overflow:auto; background:#f4f4f4; padding:8px;"
        >
          {state.log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
});
