import { searchForBoard } from '../../generation/search';
import type { SearchConfig } from '../../generation/search';
import { listStrategies, getStrategy } from '../../generation/registry';
import { DEFAULT_WEIGHTS } from '../../generation/scorer';
import type { ScoreWeights } from '../../generation/scorer';
import type {
  BoardGenerationGoal,
  OrchestratorConfig,
  OrchestratorResult,
  ToolRegistry,
} from './types';

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

const DEFAULT_TOOLS: ToolRegistry = {
  availableStrategies: ['frequency-weighted'],
  weightsForStyle(style): Partial<ScoreWeights> {
    switch (style) {
      case 'long-word-heavy':
        return {
          maxWordLength: 12.0,
          averageWordLength: 6.0,
          playerRelevantWords: 0.5,
        };
      case 'rare-letter':
      case 'chaotic':
        return {
          letterEntropy: 18.0,
          playerRelevantWords: 0.7,
        };
      case 'classic':
      case 'balanced':
      default:
        return {};
    }
  },
};

const PICK_STRATEGY_SYSTEM = `You are a board-generation strategy router.
Available strategies (pick exactly one of these names):
{strategies}

Reply with ONLY the strategy name, no explanation.`;

const EXPLAIN_SYSTEM = `You are a Word Finder coach. In ONE short sentence, hype the player about THIS board.

HARD RULE — NEVER spoil specific words. Do NOT name, quote, or hint at any actual word that can be found on the board. No quoted strings, no examples like "x", no spelling out letters.

Talk about the *qualities* — long-word potential, letter mix, rare letters, prefix/suffix opportunities, vibe — and why hunting will be fun. No greetings, no preamble.`;

export class Orchestrator {
  private readonly tools: ToolRegistry;
  constructor(private readonly config: OrchestratorConfig) {
    this.tools = {
      ...DEFAULT_TOOLS,
      // Filter to strategies that are actually registered (defensive against
      // stale tool registries pointing at strategies we removed).
      availableStrategies:
        config.tools.availableStrategies?.filter((s) => getStrategy(s)) ??
        listStrategies(),
      weightsForStyle:
        config.tools.weightsForStyle ?? DEFAULT_TOOLS.weightsForStyle,
    };
  }

  async generateBoard(
    goal: BoardGenerationGoal,
    dictionary: readonly string[]
  ): Promise<OrchestratorResult> {
    const t0 = performance.now();
    const tracer = this.config.tracer;
    const handle = tracer.startTrace({
      generation_id: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      goal_signature: goalSignature(goal),
      model_versions: { orchestrator: this.config.model.id },
    });
    const root = handle.startSpan('agent.generate_board', 'AGENT');
    root.setAttribute('model_id', this.config.model.id);
    root.setAttribute('goal_signature', goalSignature(goal));
    root.setInputs(goal);

    const cb = this.config.callbacks ?? {};
    let modelCalls = 0;
    try {
      cb.onNarrate?.('🎯 Goal received; preparing the model.');

      // Step 1 — SLM picks strategy.
      cb.onNarrate?.('🤔 Asking the model which strategy to use…');
      const strategyChosen = await this.pickStrategy(goal, handle, root);
      modelCalls++;
      cb.onNarrate?.(`💡 Strategy chosen: ${strategyChosen}`);

      // Step 2 — search engine runs with goal-derived weights. If a floor
      // is set, retry up to maxAttempts until met (then keep the best).
      const styleWeights = this.tools.weightsForStyle?.(goal.style) ?? {};
      const maxCandidates = this.config.budget?.maxCandidates ?? 75;
      const minFloor = goal.minPlayerRelevantWords ?? 0;
      const maxAttempts = goal.maxAttempts ?? 3;
      const strategy = getStrategy(strategyChosen);
      const searchSpan = handle.startSpan('tool.search', 'TOOL', root);
      searchSpan.setInputs({ strategy: strategyChosen, goal });

      let searchResult: ReturnType<typeof searchForBoard> | null = null;
      let attempt = 0;
      while (attempt < maxAttempts) {
        attempt++;
        cb.onNarrate?.(
          minFloor > 0
            ? `🔍 Searching (attempt ${attempt}/${maxAttempts}): best-of-${maxCandidates}, target ≥${minFloor} player words…`
            : `🔍 Searching: best-of-${maxCandidates} candidates with ${goal.style ?? 'balanced'} weights…`
        );
        const r = searchForBoard({
          size: goal.size,
          language: 'English',
          minWordLength: goal.minWordLength,
          dictionary: [...dictionary],
          strategy,
          maxCandidates,
          maxMs: this.config.budget?.maxSearchMs ?? 5000,
          scoreWeights: { ...DEFAULT_WEIGHTS, ...styleWeights } as Partial<ScoreWeights>,
          onCandidate: cb.onSearchProgress,
          // Tracer NOT passed through — orchestrator owns the trace; the
          // search engine gets a no-op tracer so we don't double-count the
          // work in MLflow as two parallel traces.
        } as SearchConfig);
        if (
          searchResult === null ||
          r.score.finalScore > searchResult.score.finalScore
        ) {
          searchResult = r;
        }
        if (searchResult.score.playerRelevantWords >= minFloor) {
          if (minFloor > 0 && attempt > 1) {
            cb.onNarrate?.(
              `✓ Floor met on attempt ${attempt}: ${searchResult.score.playerRelevantWords} ≥ ${minFloor}.`
            );
          }
          break;
        }
        if (attempt < maxAttempts && minFloor > 0) {
          cb.onNarrate?.(
            `↩️ Below floor (${r.score.playerRelevantWords} < ${minFloor}); retrying…`
          );
        }
      }
      // searchResult is guaranteed non-null because the loop runs at least once.
      // (TypeScript narrowing — assert.)
      if (!searchResult) {
        throw new Error('search returned no result');
      }
      cb.onNarrate?.(
        `📊 Search done: kept board with ${searchResult.score.playerRelevantWords} ${goal.minWordLength}+ letter words (max ${searchResult.score.maxWordLength}).`
      );
      searchSpan.setAttribute('candidates_evaluated', searchResult.candidatesEvaluated);
      searchSpan.setAttribute('reason', searchResult.reason);
      searchSpan.setAttribute('strategy', searchResult.strategyUsed);
      searchSpan.setAttribute('final_score', searchResult.score.finalScore);
      searchSpan.setAttribute('player_relevant_words', searchResult.score.playerRelevantWords);
      searchSpan.setOutputs({
        board: searchResult.board,
        finalScore: searchResult.score.finalScore,
      });
      searchSpan.end();

      // Step 3 — SLM explains why the board is good.
      cb.onNarrate?.('💬 Asking the model to explain why this board is fun…');
      const explanation = await this.explainBoard(
        goal,
        searchResult.board,
        searchResult.score.playerRelevantWords,
        searchResult.score.maxWordLength,
        searchResult.words,
        handle,
        root
      );
      modelCalls++;
      cb.onNarrate?.('✅ Done.');

      const elapsedMs = performance.now() - t0;
      root.setAttribute('model_calls', modelCalls);
      root.setAttribute('elapsed_ms', elapsedMs);
      root.setOutputs({
        board: searchResult.board,
        explanation,
        finalScore: searchResult.score.finalScore,
      });
      root.end();

      const trace = handle.finish({
        final_score: searchResult.score.finalScore,
        final_metrics: { ...searchResult.score },
        elapsed_ms: elapsedMs,
        candidates_evaluated: searchResult.candidatesEvaluated,
        model_calls: modelCalls,
        estimated_cost_usd: 0,
        budget_exhausted: searchResult.reason !== 'target-met',
        selected_strategy: strategyChosen,
      });

      return {
        board: searchResult.board,
        score: searchResult.score,
        words: searchResult.words,
        strategyChosen,
        explanation,
        modelCalls,
        elapsedMs,
        trace,
      };
    } catch (e) {
      const err = e as Error;
      root.recordError({ message: err.message, stack: err.stack });
      root.end();
      handle.finish({
        final_score: 0,
        final_metrics: { error: err.message },
        elapsed_ms: performance.now() - t0,
        candidates_evaluated: 0,
        model_calls: modelCalls,
        estimated_cost_usd: 0,
        budget_exhausted: true,
        selected_strategy: '(error)',
      });
      throw e;
    }
  }

  private async pickStrategy(
    goal: BoardGenerationGoal,
    handle: ReturnType<typeof this.config.tracer.startTrace>,
    parent: ReturnType<typeof handle.startSpan>
  ): Promise<string> {
    const span = handle.startSpan('model.pick_strategy', 'CHAT_MODEL', parent);
    const strategies = this.tools.availableStrategies;
    const sys = PICK_STRATEGY_SYSTEM.replace(
      '{strategies}',
      strategies.join(', ')
    );
    const userMsg = `Goal: ${JSON.stringify({
      size: goal.size,
      minWordLength: goal.minWordLength,
      style: goal.style ?? 'balanced',
      difficulty: goal.difficulty ?? 'medium',
      novelty: goal.novelty ?? 'medium',
      ...(goal.description ? { description: goal.description } : {}),
    })}\nWhich strategy? Reply with one of: ${strategies.join(', ')}`;
    span.setInputs({ system: sys, user: userMsg });

    const cb = this.config.callbacks ?? {};
    let acc = '';
    const response = await this.config.model.generate({
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userMsg },
      ],
      maxTokens: 24,
      temperature: 0.1,
      onToken: cb.onTokenStream
        ? (chunk) => {
            acc += chunk;
            cb.onTokenStream!(chunk, acc);
          }
        : undefined,
    });
    span.setAttribute('elapsed_ms', response.elapsedMs);
    span.setAttribute('output_text', response.text);

    // Parse: find a recognized strategy name in the response.
    const lower = response.text.toLowerCase();
    const match =
      strategies.find((s) => lower.includes(s.toLowerCase())) ?? strategies[0];
    span.setOutputs({ chosen: match, raw: response.text });
    span.end();
    return match;
  }

  private async explainBoard(
    goal: BoardGenerationGoal,
    board: string,
    playerRelevantWords: number,
    maxWordLength: number,
    _words: readonly string[],
    handle: ReturnType<typeof this.config.tracer.startTrace>,
    parent: ReturnType<typeof handle.startSpan>
  ): Promise<string> {
    const span = handle.startSpan('model.explain', 'CHAT_MODEL', parent);
    // Don't pass actual words — model would name them and spoil the puzzle.
    // Also don't pass the board letters because the model is happy to read
    // them aloud. Stick to abstract qualities the model can riff on without
    // peeking at the answers.
    const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
    const cells = [...board.toLowerCase()];
    const vowelCount = cells.filter((c) => VOWELS.has(c)).length;
    const rareLetters = cells.filter((c) => 'jkqvxz'.includes(c));
    const userMsg = [
      `${goal.size}x${goal.size} grid.`,
      `Player goal: words ≥${goal.minWordLength} letters.`,
      `Available: ${playerRelevantWords} player-relevant words; longest length ${maxWordLength}.`,
      `Vowel ratio: ${(vowelCount / cells.length).toFixed(2)}.`,
      rareLetters.length
        ? `Rare letters present: ${rareLetters.length} (good for unusual words).`
        : 'No rare letters.',
      `Style: ${goal.style ?? 'balanced'}.`,
      'Hype the player. NEVER spoil specific words.',
    ].join('\n');
    span.setInputs({ system: EXPLAIN_SYSTEM, user: userMsg });

    const cb = this.config.callbacks ?? {};
    let acc = '';
    const response = await this.config.model.generate({
      messages: [
        { role: 'system', content: EXPLAIN_SYSTEM },
        { role: 'user', content: userMsg },
      ],
      maxTokens: 96,
      temperature: 0.4,
      onToken: cb.onTokenStream
        ? (chunk) => {
            acc += chunk;
            cb.onTokenStream!(chunk, acc);
          }
        : undefined,
    });
    span.setAttribute('elapsed_ms', response.elapsedMs);
    span.setOutputs({ explanation: response.text });
    span.end();
    return response.text.trim();
  }
}
