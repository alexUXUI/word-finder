import type {
  GenerateRequest,
  GenerateResponse,
  LoadProgress,
  LocalModelProvider,
} from './types';

/**
 * Transformers.js LocalModelProvider.
 *
 * Real SLM. No mocks. Default model: onnx-community/Qwen2.5-0.5B-Instruct
 * (q4, ~300 MB download, runs on WebGPU when available, WASM otherwise).
 *
 * Lazy-loaded via a dynamic import so the heavy `@huggingface/transformers`
 * bundle isn't included in the SSR / first-paint path.
 */
export class TransformersJsProvider implements LocalModelProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities = {
    json: false, // we don't constrain output yet — orchestrator parses JSON best-effort
    streaming: false,
    toolCalling: false,
  };

  private modelId: string;
  private dtype: 'fp32' | 'fp16' | 'q8' | 'q4' = 'q4';
  private device: 'webgpu' | 'wasm' | 'auto' = 'auto';
  private generator: unknown = null;
  private loadPromise: Promise<void> | null = null;
  private progressFn: ((p: LoadProgress) => void) | undefined;

  constructor(options: {
    modelId?: string;
    dtype?: 'fp32' | 'fp16' | 'q8' | 'q4';
    device?: 'webgpu' | 'wasm' | 'auto';
  } = {}) {
    this.modelId = options.modelId ?? 'onnx-community/Qwen2.5-0.5B-Instruct';
    this.id = `transformers-js:${this.modelId}`;
    this.displayName = `${this.modelId} (Transformers.js)`;
    this.dtype = options.dtype ?? 'q4';
    this.device = options.device ?? 'auto';
  }

  get isReady(): boolean {
    return this.generator !== null;
  }

  private transformersModule: typeof import('@huggingface/transformers') | null = null;

  async load(onProgress?: (p: LoadProgress) => void): Promise<void> {
    if (this.generator) return;
    if (this.loadPromise) return this.loadPromise;

    this.progressFn = onProgress;
    this.loadPromise = (async () => {
      onProgress?.({ file: '@huggingface/transformers', loaded: 0, status: 'importing' });
      const transformers = await import('@huggingface/transformers');
      this.transformersModule = transformers;
      const { pipeline, env } = transformers;
      // Allow remote model downloads from the Hugging Face Hub. We don't
      // cache locally beyond the browser's IndexedDB / memfs cache; subsequent
      // page loads in the same browser reuse the cached weights.
      env.allowRemoteModels = true;
      env.allowLocalModels = false;

      const device =
        this.device === 'auto'
          ? await this.detectDevice()
          : this.device;

      onProgress?.({ file: this.modelId, loaded: 0, status: `loading on ${device}` });

      const generator = await pipeline(
        'text-generation',
        this.modelId,
        {
          dtype: this.dtype,
          device,
          progress_callback: (info: unknown) => {
            const i = info as {
              file?: string;
              status?: string;
              loaded?: number;
              total?: number;
            };
            if (!i || !i.file) return;
            onProgress?.({
              file: i.file,
              loaded: i.loaded ?? 0,
              total: i.total,
              status: i.status ?? 'progress',
            });
          },
        }
      );
      this.generator = generator;
      onProgress?.({ file: this.modelId, loaded: 1, total: 1, status: 'ready' });
    })().finally(() => {
      this.loadPromise = null;
    });
    return this.loadPromise;
  }

  private async detectDevice(): Promise<'webgpu' | 'wasm'> {
    if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
      try {
        // @ts-expect-error — navigator.gpu may not be typed in older lib.dom
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) return 'webgpu';
      } catch {
        /* fall through to wasm */
      }
    }
    return 'wasm';
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    if (!this.generator) {
      throw new Error(
        `TransformersJsProvider not ready. Call load() before generate(). model=${this.modelId}`
      );
    }
    const t0 = performance.now();
    // The Transformers.js text-generation pipeline accepts chat-formatted
    // messages directly when the tokenizer has a chat_template (Qwen's does).
    const opts: Record<string, unknown> = {
      max_new_tokens: req.maxTokens ?? 256,
      temperature: req.temperature ?? 0.2,
      do_sample: (req.temperature ?? 0.2) > 0,
      return_full_text: false,
    };
    if (req.onToken && this.transformersModule) {
      // Wire TextStreamer so each decoded chunk fires the callback as
      // the model produces it.
      const { TextStreamer } = this.transformersModule as unknown as {
        TextStreamer: new (
          tokenizer: unknown,
          options: { skip_prompt?: boolean; callback_function?: (s: string) => void }
        ) => unknown;
      };
      const tokenizer = (this.generator as { tokenizer: unknown }).tokenizer;
      opts.streamer = new TextStreamer(tokenizer, {
        skip_prompt: true,
        callback_function: req.onToken,
      });
    }
    const out = await (
      this.generator as (
        msgs: readonly { role: string; content: string }[],
        opts: Record<string, unknown>
      ) => Promise<unknown>
    )(req.messages, opts);

    const elapsedMs = performance.now() - t0;
    const arr = Array.isArray(out) ? (out as unknown[]) : [out];
    const first = arr[0] as
      | { generated_text?: string | { role: string; content: string }[] }
      | undefined;

    let text = '';
    if (first && typeof first.generated_text === 'string') {
      text = first.generated_text;
    } else if (first && Array.isArray(first.generated_text)) {
      const lastMsg = first.generated_text[first.generated_text.length - 1];
      text = typeof lastMsg === 'string' ? lastMsg : lastMsg?.content ?? '';
    }

    return {
      text,
      elapsedMs,
      raw: first,
    };
  }
}
