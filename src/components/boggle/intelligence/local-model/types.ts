/**
 * LocalModelProvider — interface for browser-resident SLMs.
 *
 * Phase 2.0b ships TransformersJsProvider (Qwen2.5-0.5B-Instruct, q4, with
 * WebGPU acceleration where available, WASM fallback otherwise).
 *
 * Phase 2.0c+ uses this through the orchestrator: every model call is a
 * CHAT_MODEL span in the generation trace.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateRequest {
  messages: readonly ChatMessage[];
  /** Cap on the assistant's response (in tokens). Default: 256. */
  maxTokens?: number;
  /** 0..1; default 0.2 — favor structured / deterministic outputs. */
  temperature?: number;
  /** If set, the provider should attempt to constrain output to JSON. */
  jsonOnly?: boolean;
  /** Optional abort signal to cancel the call. */
  signal?: AbortSignal;
}

export interface GenerateResponse {
  /** Assistant message content. */
  text: string;
  /** Total model wall-clock (ms). */
  elapsedMs: number;
  /** Tokens generated (input + output if available). */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  /** Raw provider object for debugging. */
  raw?: unknown;
}

export interface LoadProgress {
  /** Loadable artifact ("model.onnx", "tokenizer.json", etc.). */
  file: string;
  /** Bytes loaded. */
  loaded: number;
  /** Total bytes (if known). */
  total?: number;
  /** Lifecycle stage for the UI: "downloading", "compiling", "ready", etc. */
  status: string;
}

export interface LocalModelProvider {
  readonly id: string;
  /** Human-readable. */
  readonly displayName: string;
  /** True when the model is loaded and ready to call. */
  readonly isReady: boolean;
  /** Capabilities the provider advertises. */
  readonly capabilities: {
    json: boolean;
    streaming: boolean;
    toolCalling: boolean;
  };
  /**
   * Lazy-load the model. Idempotent — safe to call repeatedly. The progress
   * callback fires as the model downloads / initializes.
   */
  load(onProgress?: (p: LoadProgress) => void): Promise<void>;
  /** Run a single chat-style generation. */
  generate(req: GenerateRequest): Promise<GenerateResponse>;
}
