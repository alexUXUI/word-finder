/**
 * Pipeline runner. Walks the role graph, threading `RoleContext` through
 * each step, producing a `PipelineResult` plus a `GenerationTrace`.
 *
 * Flow (with optional steps in []):
 *   PromptParser → StrategyRouter → CandidateGenerator
 *     → [Mutator loop: iterations × proposeSwaps + apply + score]
 *     → [Critic.rate per candidate]
 *     → Aggregator.pick
 *     → Narrator.narrate
 *
 * The runner emits one MLflow span per role step, plus per-iteration spans
 * for the mutator loop. The trace shape is independent of which
 * implementations the pipeline picked — that's the point.
 */

import type { Pipeline, RoleModelOverrides } from './types';
import type {
  BoardGenerationGoal,
  PipelineResult,
  RoleContext,
  ScoredBoard,
  ScoredBoardWithCritic,
} from '../roles/types';
import { getProviderForId } from '../local-model/factory';
import {
  wrapProviderForCapture,
  type TraceSink,
  type TraceRecord,
} from '../local-model/capturing-provider';
import {
  listStrategiesForLanguage,
  getStrategy,
} from '../../generation/registry';
import { buildTrie } from '../../logic/trie';
import { solveWithTrie } from '../../logic/boggle';
import { scoreBoard, DEFAULT_WEIGHTS } from '../../generation/scorer';
import type { ScoreWeights } from '../../generation/scorer';
import type { LocalModelProvider } from '../local-model/types';
import type { Tracer } from '../../generation/trace';

export interface PipelineRunInput {
  goal: BoardGenerationGoal;
  dictionary: readonly string[];
  /** Optional model provider — required by SLM-using role implementations. */
  model?: LocalModelProvider;
  tracer: Tracer;
  /** UI / lifecycle callbacks. */
  callbacks?: {
    onNarrate?: (line: string) => void;
    onTokenStream?: (chunk: string, accumulator: string) => void;
    onSearchProgress?: (info: {
      index: number;
      total: number;
      bestScore: number;
      playerRelevantWords: number;
    }) => void;
  };
  signal?: AbortSignal;
  /** Per-style weight overrides. Falls back to default scorer weights. */
  weightsForStyle?: (style: BoardGenerationGoal['style']) => Partial<ScoreWeights>;
  /**
   * Trace capture for distillation. When set, every model.generate call
   * is recorded with (role, system, user, output) and joined to the
   * pipeline's outcome score post-hoc. See `docs/DISTILLATION.md`.
   */
  captureTraces?: TraceSink;
}

const goalSignature = (g: BoardGenerationGoal): string => {
  const parts = [
    `size=${g.size}`,
    `min=${g.minWordLength}`,
    g.style ? `style=${g.style}` : null,
    g.difficulty ? `diff=${g.difficulty}` : null,
    g.novelty ? `nov=${g.novelty}` : null,
    g.requiredLetters?.length ? `req=${g.requiredLetters.join('')}` : null,
    g.avoidedLetters?.length ? `avoid=${g.avoidedLetters.join('')}` : null,
  ].filter(Boolean);
  return parts.join(';');
};

/** Apply a swap in place to a flat board string; returns a new string. */
const applySwap = (board: string, i: number, j: number): string => {
  if (i === j) return board;
  const cells = board.split('');
  [cells[i], cells[j]] = [cells[j], cells[i]];
  return cells.join('');
};

/**
 * Re-solve and score a board after mutation. Caller passes the prebuilt
 * trie so we don't pay the build cost per iteration.
 */
const rescore = (
  board: string,
  goal: BoardGenerationGoal,
  trie: ReturnType<typeof buildTrie>,
  weights: Readonly<ScoreWeights>
): ScoredBoard => {
  const words = solveWithTrie(trie, board.split(''));
  const score = scoreBoard(board, words, {
    minWordLength: goal.minWordLength,
    weights,
  });
  return { board, words, score, source: 'mutated' };
};

export const runPipeline = async (
  pipeline: Pipeline,
  input: PipelineRunInput
): Promise<PipelineResult> => {
  const t0 = performance.now();
  const cb = input.callbacks ?? {};
  const goalIn = input.goal;

  const handle = input.tracer.startTrace({
    generation_id: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    goal_signature: goalSignature(goalIn),
    model_versions: { orchestrator: input.model?.id ?? 'no-model' },
  });
  const root = handle.startSpan('pipeline.run', 'AGENT');
  root.setAttribute('pipeline_id', pipeline.id);
  root.setAttribute('pipeline_version', pipeline.version);
  root.setAttribute('goal_signature', goalSignature(goalIn));
  root.setInputs({ pipeline: pipeline.id, goal: goalIn });

  const baseWeights: ScoreWeights = {
    ...DEFAULT_WEIGHTS,
    ...(input.weightsForStyle?.(goalIn.style) ?? {}),
  };

  const baseCtx: RoleContext = {
    trace: input.tracer,
    parentSpanId: undefined,
    model: input.model,
    dictionary: input.dictionary,
    narrate: cb.onNarrate,
    tokenStream: cb.onTokenStream,
    searchProgress: cb.onSearchProgress,
    signal: input.signal,
    scoreWeights: baseWeights,
  };

  // Pending trace records — filled by the capturing-provider wrappers as
  // each role's model.generate fires. After the pipeline completes we
  // attach the outcome (finalScore, playerWords, floorMet) to every
  // record and ship them to the sink. This pairing is the whole point:
  // training data wants the (input, output, *outcome*) tuple.
  const pendingTraces: TraceRecord[] = [];

  /**
   * Resolve the model for a given role. If the pipeline has a per-role
   * override, instantiate (or fetch from cache) the named provider and
   * lazy-load it. Otherwise return the default `input.model`. When
   * `input.captureTraces` is set, wrap the resolved provider in a
   * capturing decorator that buffers each call's payload.
   */
  const ctxFor = async (
    roleKind: keyof RoleModelOverrides,
    roleImplId: string
  ): Promise<RoleContext> => {
    const overrideId = pipeline.roleModels?.[roleKind];
    let provider = baseCtx.model;
    if (overrideId) {
      const p = getProviderForId(overrideId);
      if (!p.isReady) {
        cb.onNarrate?.(`⏳ Loading ${overrideId} for role "${roleKind}"…`);
        await p.load();
      }
      provider = p;
    }
    if (provider && input.captureTraces) {
      provider = wrapProviderForCapture(provider, {
        role: roleKind,
        roleImpl: roleImplId,
        traceId: handle.trace_id,
        generationId: handle.trace_id, // 1:1 today; split later if needed
        pending: pendingTraces,
      });
    }
    return { ...baseCtx, model: provider };
  };

  // (All call sites use ctxFor() per role — there's no shared ctx.)

  let modelCalls = 0;
  let candidatesEvaluated = 0;
  let mutationsApplied = 0;

  try {
    // Step 0 — PromptParser
    cb.onNarrate?.('🎯 Pipeline: ' + pipeline.id);
    const parserSpan = handle.startSpan(`role.${pipeline.roles.promptParser.id}`, 'CHAIN', root);
    const parserCtx = await ctxFor('prompt-parser', pipeline.roles.promptParser.id);
    const parsedGoal = await pipeline.roles.promptParser.parse(goalIn, parserCtx);
    parserSpan.setAttribute('role', 'prompt-parser');
    parserSpan.setAttribute('impl', pipeline.roles.promptParser.id);
    parserSpan.setAttribute('model_id', parserCtx.model?.id ?? 'none');
    parserSpan.end();

    // Step 1 — StrategyRouter
    // Only offer strategies that support the goal's language. Without this
    // an English goal could be routed to `legacy-russian` and produce a
    // Cyrillic board with 0 player words (we have an English-only
    // dictionary).
    const available = listStrategiesForLanguage(parsedGoal.language);
    if (available.length === 0) {
      throw new Error(
        `No strategies registered for language: ${parsedGoal.language}`
      );
    }
    cb.onNarrate?.('🤔 Strategy router…');
    const routerSpan = handle.startSpan(`role.${pipeline.roles.strategyRouter.id}`, 'CHAT_MODEL', root);
    const routerCtx = await ctxFor('strategy-router', pipeline.roles.strategyRouter.id);
    const strategyId = await pipeline.roles.strategyRouter.route(parsedGoal, available, routerCtx);
    if (pipeline.roles.strategyRouter.id !== 'rule-based:frequency-weighted' &&
        pipeline.roles.strategyRouter.id.startsWith('slm')) {
      modelCalls++;
    }
    if (pipeline.roles.strategyRouter.id.startsWith('slm')) {
      modelCalls++;
    }
    const strategy = getStrategy(strategyId);
    if (!strategy) throw new Error(`pipeline returned unknown strategy: ${strategyId}`);
    routerSpan.setAttribute('role', 'strategy-router');
    routerSpan.setAttribute('impl', pipeline.roles.strategyRouter.id);
    routerSpan.setAttribute('chosen', strategyId);
    routerSpan.setAttribute('model_id', routerCtx.model?.id ?? 'none');
    routerSpan.end();
    cb.onNarrate?.(`💡 Strategy: ${strategyId}`);

    // Step 2 — CandidateGenerator
    cb.onNarrate?.('🔍 Generating candidates…');
    const genSpan = handle.startSpan(`role.${pipeline.roles.candidateGenerator.id}`, 'TOOL', root);
    const genCtx = await ctxFor('candidate-generator', pipeline.roles.candidateGenerator.id);
    let candidates = await pipeline.roles.candidateGenerator.generate({
      goal: parsedGoal,
      strategyId,
      ctx: genCtx,
    });
    candidatesEvaluated += candidates.length;
    genSpan.setAttribute('role', 'candidate-generator');
    genSpan.setAttribute('impl', pipeline.roles.candidateGenerator.id);
    genSpan.setAttribute('candidates', candidates.length);
    genSpan.end();
    if (candidates.length === 0) throw new Error('candidate generator returned empty pool');

    // Step 3 — Mutator loop (optional)
    if (pipeline.roles.mutator && pipeline.mutationLoop) {
      const mut = pipeline.roles.mutator;
      const cfg = pipeline.mutationLoop;
      const trie = buildTrie([...input.dictionary]);
      // Mutator hill-climbs the best candidate.
      let current: ScoredBoard = candidates.reduce((a, b) =>
        b.score.finalScore > a.score.finalScore ? b : a
      );
      const mutSpan = handle.startSpan(`role.${mut.id}`, 'TOOL', root);
      mutSpan.setAttribute('role', 'mutator');
      mutSpan.setAttribute('impl', mut.id);
      mutSpan.setAttribute('iterations', cfg.iterations);
      cb.onNarrate?.(`🧬 Hill-climb (${mut.id}, ${cfg.iterations} iters × ${cfg.swapsPerIteration} swaps)…`);
      const mutCtx = await ctxFor('mutator', mut.id);
      mutSpan.setAttribute('model_id', mutCtx.model?.id ?? 'none');
      for (let iter = 0; iter < cfg.iterations; iter++) {
        if (input.signal?.aborted) break;
        const iterSpan = handle.startSpan(`mutator.iter.${iter}`, 'TOOL', mutSpan);
        const swaps = await mut.proposeSwaps({
          board: current,
          goal: parsedGoal,
          k: cfg.swapsPerIteration,
          ctx: mutCtx,
        });
        if (mut.id.startsWith('slm')) modelCalls++;
        iterSpan.setAttribute('proposed', swaps.length);
        let bestThisIter: ScoredBoard = current;
        for (const swap of swaps) {
          const candidateBoard = applySwap(current.board, swap.i, swap.j);
          const cand = rescore(candidateBoard, parsedGoal, trie, baseWeights);
          candidatesEvaluated++;
          if (cand.score.finalScore > bestThisIter.score.finalScore) {
            bestThisIter = cand;
          }
        }
        const accept = cfg.acceptOnlyImprovements === false
          ? bestThisIter !== current
          : bestThisIter.score.finalScore > current.score.finalScore;
        if (accept) {
          mutationsApplied++;
          iterSpan.setAttribute('accepted', true);
          iterSpan.setAttribute('delta', bestThisIter.score.finalScore - current.score.finalScore);
          current = bestThisIter;
          cb.onNarrate?.(
            `↗︎ iter ${iter + 1}: +${(
              bestThisIter.score.finalScore - current.score.finalScore
            ).toFixed(1)} → ${bestThisIter.score.playerRelevantWords} player words`
          );
        } else {
          iterSpan.setAttribute('accepted', false);
        }
        iterSpan.end();
      }
      mutSpan.setAttribute('mutations_applied', mutationsApplied);
      mutSpan.end();
      // Hill-climbed result replaces the candidate pool.
      candidates = [current];
    }

    // Step 4 — Critic (optional)
    let scored: ScoredBoardWithCritic[];
    if (pipeline.roles.critic) {
      const critic = pipeline.roles.critic;
      const critSpan = handle.startSpan(`role.${critic.id}`, 'EVALUATION', root);
      critSpan.setAttribute('role', 'critic');
      critSpan.setAttribute('impl', critic.id);
      const critCtx = await ctxFor('critic', critic.id);
      critSpan.setAttribute('model_id', critCtx.model?.id ?? 'none');
      const ratings = await Promise.all(
        candidates.map((c) => critic.rate({ board: c, goal: parsedGoal, ctx: critCtx }))
      );
      if (critic.id.startsWith('slm')) modelCalls += candidates.length;
      scored = candidates.map((c, i) => ({ ...c, critic: ratings[i] }));
      critSpan.end();
    } else {
      scored = candidates.map((c) => ({ ...c }));
    }

    // Step 5 — Aggregator
    const aggSpan = handle.startSpan(`role.${pipeline.roles.aggregator.id}`, 'CHAIN', root);
    const aggCtx = await ctxFor('aggregator', pipeline.roles.aggregator.id);
    const chosen = await pipeline.roles.aggregator.pick({
      candidates: scored,
      goal: parsedGoal,
      ctx: aggCtx,
    });
    aggSpan.setAttribute('role', 'aggregator');
    aggSpan.setAttribute('impl', pipeline.roles.aggregator.id);
    aggSpan.setAttribute('chosen_score', chosen.score.finalScore);
    aggSpan.end();

    // Step 6 — Narrator
    cb.onNarrate?.('💬 Narrating…');
    const narrSpan = handle.startSpan(`role.${pipeline.roles.narrator.id}`, 'CHAT_MODEL', root);
    const narrCtx = await ctxFor('narrator', pipeline.roles.narrator.id);
    narrSpan.setAttribute('model_id', narrCtx.model?.id ?? 'none');
    const explanation = await pipeline.roles.narrator.narrate({
      chosen,
      goal: parsedGoal,
      ctx: narrCtx,
    });
    if (pipeline.roles.narrator.id.startsWith('slm')) modelCalls++;
    narrSpan.setAttribute('role', 'narrator');
    narrSpan.setAttribute('impl', pipeline.roles.narrator.id);
    narrSpan.setAttribute('output_chars', explanation.length);
    narrSpan.end();

    cb.onNarrate?.('✅ Done.');
    const elapsedMs = performance.now() - t0;
    const floor = goalIn.minPlayerRelevantWords ?? 0;
    const floorMet = floor === 0 || chosen.score.playerRelevantWords >= floor;

    root.setAttribute('model_calls', modelCalls);
    root.setAttribute('candidates_evaluated', candidatesEvaluated);
    root.setAttribute('mutations_applied', mutationsApplied);
    root.setAttribute('elapsed_ms', elapsedMs);
    root.setAttribute('final_score', chosen.score.finalScore);
    root.setAttribute('player_relevant_words', chosen.score.playerRelevantWords);
    root.setOutputs({ board: chosen.board, finalScore: chosen.score.finalScore });
    root.end();

    const trace = handle.finish({
      final_score: chosen.score.finalScore,
      final_metrics: { ...chosen.score },
      elapsed_ms: elapsedMs,
      candidates_evaluated: candidatesEvaluated,
      model_calls: modelCalls,
      estimated_cost_usd: 0,
      budget_exhausted: false,
      selected_strategy: strategyId,
    });

    // Trace capture: now that the pipeline finished, attach the outcome
    // to every captured role-call record and ship them to the sink. This
    // is what makes the records useful for distillation — each (input,
    // output) pair gets joined to the final-score it contributed to.
    if (input.captureTraces && pendingTraces.length) {
      for (const rec of pendingTraces) {
        rec.outcomeFinalScore = chosen.score.finalScore;
        rec.outcomePlayerWords = chosen.score.playerRelevantWords;
        rec.outcomeFloorMet = floorMet;
        input.captureTraces(rec);
      }
    }

    return {
      board: chosen.board,
      score: chosen.score,
      words: [...chosen.words],
      strategy: strategyId,
      explanation,
      modelCalls,
      candidatesEvaluated,
      mutationsApplied,
      elapsedMs,
      floorMet,
      trace,
      criticScore: chosen.critic,
    };
  } catch (e) {
    const err = e as Error;
    root.recordError({ message: err.message, stack: err.stack });
    root.end();
    handle.finish({
      final_score: 0,
      final_metrics: { error: err.message },
      elapsed_ms: performance.now() - t0,
      candidates_evaluated: candidatesEvaluated,
      model_calls: modelCalls,
      estimated_cost_usd: 0,
      budget_exhausted: true,
      selected_strategy: '(error)',
    });
    throw e;
  }
};
