/**
 * MockProvider — deterministic, scriptable LocalModelProvider.
 *
 * Used by CI / benches that don't want to depend on a real model. Lets us
 * answer questions like "do the SLM-using pipelines emit the right span
 * shape" and "does the bench statistical machinery work" without paying
 * download cost or token bills.
 *
 * For the *interesting* bench question — does algorithm A actually beat the
 * baseline at matched compute — you need a real model (run with
 * `BENCH_USE_REAL_MODEL=1`). The mock will return cheap-but-plausible
 * outputs that prevent crashes; it cannot tell you whether the SLM mutator
 * encodes useful priors.
 */

import type {
  LocalModelProvider,
  GenerateRequest,
  GenerateResponse,
} from './types';

export interface MockProviderOptions {
  id?: string;
  /**
   * If supplied, called with each request and expected to return the
   * assistant text. Else a default generator picks a "reasonable" reply.
   */
  scriptedReply?: (req: GenerateRequest) => string;
  /** Simulated latency (ms). Default 5. */
  latencyMs?: number;
}

const DEFAULT_REPLY = (req: GenerateRequest): string => {
  const sys = req.messages.find((m) => m.role === 'system')?.content ?? '';
  // Strategy router → return the first strategy mentioned in the system prompt.
  if (sys.includes('strategy router')) {
    const m = sys.match(/Available strategies[\s\S]*?:\s*([a-z][a-z0-9-, ]*)/i);
    if (m) return m[1].split(',')[0].trim();
    return 'frequency-weighted';
  }
  // Mutator → return JSON proposing 3 plausible swaps for a 25-cell board.
  // Cells 0..24; pick distinct pairs that don't trip the validator.
  if (sys.includes('Boggle board optimizer')) {
    return JSON.stringify([
      { i: 0, j: 12, rationale: 'mock swap' },
      { i: 4, j: 20, rationale: 'mock swap' },
      { i: 7, j: 18, rationale: 'mock swap' },
    ]);
  }
  // Judge → return a neutral rating.
  if (sys.includes('Boggle board judge')) {
    return JSON.stringify({ rating: 0.5, reasoning: 'mock' });
  }
  // Narrator → one short sentence.
  return 'A balanced grid with strong word potential.';
};

export const makeMockProvider = (
  opts: MockProviderOptions = {}
): LocalModelProvider => {
  let ready = false;
  return {
    id: opts.id ?? 'mock',
    displayName: 'Mock (deterministic)',
    get isReady() {
      return ready;
    },
    capabilities: { json: true, streaming: true, toolCalling: false },
    async load(): Promise<void> {
      ready = true;
    },
    async generate(req: GenerateRequest): Promise<GenerateResponse> {
      if (opts.latencyMs && opts.latencyMs > 0) {
        await new Promise((r) => setTimeout(r, opts.latencyMs));
      }
      const text = (opts.scriptedReply ?? DEFAULT_REPLY)(req);
      // Stream the text chunk-by-chunk so onToken consumers see realistic
      // behavior in tests.
      if (req.onToken) {
        const chunkSize = Math.max(1, Math.floor(text.length / 4));
        for (let i = 0; i < text.length; i += chunkSize) {
          req.onToken(text.slice(i, i + chunkSize));
        }
      }
      return { text, elapsedMs: opts.latencyMs ?? 5 };
    },
  };
};
