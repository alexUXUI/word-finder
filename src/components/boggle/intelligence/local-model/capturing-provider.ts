/**
 * Capturing provider wrapper. Decorates a `LocalModelProvider` so every
 * `generate()` call appends a `TraceRecord` to a sink. Used by the bench
 * (`CAPTURE_TRACES=path/to.jsonl yarn bench`) to harvest training data
 * for distillation: tuples of (role, system prompt, user prompt, output,
 * outcome score) become the instruction-tuning dataset.
 *
 * The pipeline runner pairs each role call with the *outcome* finalScore
 * post-hoc — so a row of training data has both the per-call payload and
 * the eventual game-quality this call contributed to.
 *
 * See `docs/DISTILLATION.md` for the end-to-end workflow.
 */

import type {
  LocalModelProvider,
  GenerateRequest,
  GenerateResponse,
} from './types';

export interface TraceRecord {
  /** Role kind (e.g. 'mutator', 'strategy-router', 'narrator'). */
  role: string;
  /** Role implementation id (e.g. 'slm-swap', 'slm-router'). */
  roleImpl: string;
  /** Concrete model id used (e.g. 'transformers-js:qwen2.5-0.5b'). */
  modelId: string;
  /** System message string. */
  system: string;
  /** User message string. */
  user: string;
  /** Assistant output string. */
  output: string;
  /** Wall-clock for the model call (ms). */
  elapsedMs: number;
  /** Pipeline trace id (joins multiple role calls into one generation). */
  traceId: string;
  /** Generation id within a batch. */
  generationId: string;
  /** ISO timestamp for the call. */
  capturedAt: string;
  /**
   * Outcome — set by the runner *after* the pipeline finishes. Lets
   * downstream training filter to high-quality role calls.
   */
  outcomeFinalScore?: number;
  outcomePlayerWords?: number;
  outcomeFloorMet?: boolean;
}

export type TraceSink = (record: TraceRecord) => void;

export interface CaptureContext {
  role: string;
  roleImpl: string;
  traceId: string;
  generationId: string;
  /** Stash of records emitted during the pipeline; runner closes them out post-hoc. */
  pending: TraceRecord[];
}

export const wrapProviderForCapture = (
  inner: LocalModelProvider,
  ctx: CaptureContext
): LocalModelProvider => {
  return {
    id: inner.id,
    displayName: inner.displayName,
    capabilities: inner.capabilities,
    get isReady() {
      return inner.isReady;
    },
    load: (onProgress?) => inner.load(onProgress),
    async generate(req: GenerateRequest): Promise<GenerateResponse> {
      const r = await inner.generate(req);
      const system = req.messages.find((m) => m.role === 'system')?.content ?? '';
      const user = req.messages.find((m) => m.role === 'user')?.content ?? '';
      ctx.pending.push({
        role: ctx.role,
        roleImpl: ctx.roleImpl,
        modelId: inner.id,
        system,
        user,
        output: r.text,
        elapsedMs: r.elapsedMs,
        traceId: ctx.traceId,
        generationId: ctx.generationId,
        capturedAt: new Date().toISOString(),
      });
      return r;
    },
  };
};
