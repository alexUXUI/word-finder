import type {
  GenerateRequest,
  GenerateResponse,
  LoadProgress,
  LocalModelProvider,
} from './types';

/**
 * Server-side LocalModelProvider — POSTs to `/api/llm` (a Cloudflare
 * Pages Function) which routes to Workers AI today and a self-hosted
 * Container later. Same JSON shape as TransformersJsProvider so the
 * orchestrator can swap providers without changes.
 *
 * No on-device download → load() is a no-op and isReady is always true.
 */
export class CloudflareServerProvider implements LocalModelProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities = {
    json: false,
    streaming: false, // Phase 1 — Workers AI streaming is not wired through yet
    toolCalling: false,
  };
  readonly isReady = true;

  private readonly endpoint: string;

  constructor(options: { endpoint?: string; modelId?: string } = {}) {
    this.endpoint = options.endpoint ?? '/api/llm';
    this.id = `cloudflare-server${
      options.modelId ? `:${options.modelId}` : ''
    }`;
    this.displayName = options.modelId
      ? `Server (${options.modelId})`
      : 'Cloudflare Server (auto)';
  }

  async load(_onProgress?: (p: LoadProgress) => void): Promise<void> {
    // No-op — the model lives upstream. We don't probe the endpoint here
    // because that costs latency on every page load; the first generate()
    // call will surface a clear error if the upstream is misconfigured.
    return;
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const t0 = performance.now();
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: req.messages,
        maxTokens: req.maxTokens,
        temperature: req.temperature,
      }),
      signal: req.signal,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(
        `${this.endpoint} returned ${res.status} ${res.statusText}${
          err ? `: ${err}` : ''
        }`
      );
    }
    const data = (await res.json()) as {
      text: string;
      elapsedMs?: number;
      model?: string;
      upstream?: string;
    };
    // No streaming yet; if the caller wired onToken, fire it once with
    // the full text so existing UI (live-tokens) still updates.
    if (req.onToken && data.text) {
      req.onToken(data.text);
    }
    return {
      text: data.text ?? '',
      elapsedMs: data.elapsedMs ?? performance.now() - t0,
      raw: data,
    };
  }
}
