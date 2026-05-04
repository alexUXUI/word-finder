import type {
  CandidateGeneratorRole,
  ScoredBoard,
  RoleContext,
  BoardGenerationGoal,
  MutatorRole,
} from '../types';
import { getStrategy } from '../../../generation/registry';
import { buildTrie } from '../../../logic/trie';
import { solveWithTrie } from '../../../logic/boggle';
import { scoreBoard } from '../../../generation/scorer';
import {
  CROSSOVER_SYSTEM,
  buildCrossoverUserPrompt,
  parseCrossoverResponse,
  deterministicCrossover,
} from '../../prompts/crossover';

export interface EvolutionaryParams {
  /** Population size each generation. Default 20. */
  populationSize: number;
  /** Number of generations to run. Default 8. */
  generations: number;
  /** Top-K survivors per generation (used as parent pool). Default 4. */
  survivors: number;
  /** Children produced per generation (via crossover). Default 8. */
  children: number;
  /**
   * Mutator to use. Each newborn child is mutated via this role before
   * scoring. Same Mutator interface as the hill-climb loop, so any
   * implementation (random-swap, slm-swap) works.
   */
  mutator: MutatorRole;
  /** Mutations per child. Default 2. */
  mutationsPerChild: number;
  /**
   * Wall-clock cap (ms). Generations stop early when exceeded.
   * Default 20_000.
   */
  maxMs?: number;
  /**
   * Number of top boards to return at the end. Default 1 (single best).
   * Use `> 1` when downstream Critic needs a slate to rerank.
   */
  returnTopK?: number;
}

/**
 * Evolutionary search with SLM crossover. Algorithm B from
 * `AI_ENGINEERING.md` §3.
 *
 * Loop:
 *   - Initialize: populationSize × strategy.generate, score, sort.
 *   - Each generation:
 *     - Take top `survivors` (elitism).
 *     - Produce `children` via SLM-as-crossover from random parent pairs.
 *     - Mutate each child via the configured mutator.
 *     - Score children, merge with survivors, sort, truncate to populationSize.
 *   - Return the top-K of the final population.
 *
 * The SLM proposes children given parent pairs. If the model output is
 * unparseable, falls back to deterministic alternating-row crossover so
 * a bad call doesn't break the generation.
 */
export const makeEvolutionaryGenerator = (
  params: EvolutionaryParams
): CandidateGeneratorRole => ({
  id: `evolutionary:${params.populationSize}x${params.generations}gen`,
  kind: 'candidate-generator',
  async generate(args: {
    goal: BoardGenerationGoal;
    strategyId: string;
    seedBoard?: string;
    ctx: RoleContext;
  }): Promise<readonly ScoredBoard[]> {
    const { goal, strategyId, ctx } = args;
    const strategy = getStrategy(strategyId);
    if (!strategy) throw new Error(`unknown strategy: ${strategyId}`);

    const trie = buildTrie([...ctx.dictionary]);
    const cellCount = goal.size * goal.size;
    const maxMs = params.maxMs ?? 20_000;
    const returnTopK = Math.max(1, params.returnTopK ?? 1);
    const t0 = performance.now();

    const score = (board: string, source: string): ScoredBoard => {
      const words = solveWithTrie(trie, board.split(''));
      const sc = scoreBoard(board, words, {
        minWordLength: goal.minWordLength,
        weights: ctx.scoreWeights,
      });
      return { board, words, score: sc, source };
    };

    // Initial population.
    let population: ScoredBoard[] = [];
    for (let i = 0; i < params.populationSize; i++) {
      const generated = strategy.generate({ size: goal.size, language: goal.language });
      population.push(score(generated.board, `${strategyId}#init-${i}`));
    }
    population.sort((a, b) => b.score.finalScore - a.score.finalScore);
    ctx.searchProgress?.({
      index: population.length,
      total: params.populationSize,
      bestScore: population[0].score.finalScore,
      playerRelevantWords: population[0].score.playerRelevantWords,
    });

    const applySwap = (board: string, i: number, j: number): string => {
      const cells = board.split('');
      [cells[i], cells[j]] = [cells[j], cells[i]];
      return cells.join('');
    };

    for (let gen = 0; gen < params.generations; gen++) {
      if (performance.now() - t0 > maxMs) {
        ctx.narrate?.(`⏱ evolutionary: time budget exhausted at gen ${gen}`);
        break;
      }
      if (ctx.signal?.aborted) break;
      ctx.narrate?.(
        `🧬 gen ${gen + 1}/${params.generations}: best=${population[0].score.playerRelevantWords} words`
      );

      // Survivors (elitism).
      const survivors = population.slice(0, params.survivors);

      // Children — SLM crossover from random parent pairs.
      const children: ScoredBoard[] = [];
      for (let c = 0; c < params.children; c++) {
        if (performance.now() - t0 > maxMs) break;
        const a = survivors[Math.floor(Math.random() * survivors.length)];
        let b = survivors[Math.floor(Math.random() * survivors.length)];
        if (b === a && survivors.length > 1) {
          b = survivors[(survivors.indexOf(a) + 1) % survivors.length];
        }

        let childBoard: string | null = null;
        if (ctx.model) {
          try {
            const r = await ctx.model.generate({
              messages: [
                { role: 'system', content: CROSSOVER_SYSTEM },
                {
                  role: 'user',
                  content: buildCrossoverUserPrompt({
                    parentA: {
                      board: a.board,
                      finalScore: a.score.finalScore,
                      playerWords: a.score.playerRelevantWords,
                    },
                    parentB: {
                      board: b.board,
                      finalScore: b.score.finalScore,
                      playerWords: b.score.playerRelevantWords,
                    },
                    size: goal.size,
                    goalStyle: goal.style,
                    goalDescription: goal.description,
                  }),
                },
              ],
              maxTokens: cellCount + 32,
              temperature: 0.5,
              signal: ctx.signal,
            });
            childBoard = parseCrossoverResponse(r.text, cellCount);
          } catch {
            childBoard = null;
          }
        }
        if (!childBoard) {
          // Deterministic fallback so generation continues even if SLM
          // produces unparseable output (or we have no model).
          childBoard = deterministicCrossover(a.board, b.board, goal.size);
        }

        // Mutate the child via the configured mutator.
        let scored = score(childBoard, `child-${gen}-${c}`);
        for (let m = 0; m < params.mutationsPerChild; m++) {
          if (performance.now() - t0 > maxMs) break;
          const swaps = await params.mutator.proposeSwaps({
            board: scored,
            goal,
            k: 1,
            ctx,
          });
          if (!swaps.length) break;
          const sw = swaps[0];
          const mutated = applySwap(scored.board, sw.i, sw.j);
          const mScored = score(mutated, `child-${gen}-${c}-mut${m}`);
          if (mScored.score.finalScore > scored.score.finalScore) {
            scored = mScored;
          }
        }
        children.push(scored);
      }

      // Combine, sort, truncate.
      population = [...survivors, ...children].sort(
        (a, b) => b.score.finalScore - a.score.finalScore
      );
      // Refill if combined population shrank below target.
      while (population.length < params.populationSize) {
        const generated = strategy.generate({ size: goal.size, language: goal.language });
        population.push(score(generated.board, `${strategyId}#refill-${gen}`));
      }
      population = population.slice(0, params.populationSize);
      population.sort((a, b) => b.score.finalScore - a.score.finalScore);

      ctx.searchProgress?.({
        index: gen + 1,
        total: params.generations,
        bestScore: population[0].score.finalScore,
        playerRelevantWords: population[0].score.playerRelevantWords,
      });
    }

    return population.slice(0, returnTopK);
  },
});
