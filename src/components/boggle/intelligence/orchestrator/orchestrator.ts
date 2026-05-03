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

const EXPLAIN_SYSTEM = `You are a Word Finder coach. In ONE short sentence, tell the player why this board is fun. Mention 1-2 specific words they could find. No greetings, no preamble.`;

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

    let modelCalls = 0;
    try {
      // Step 1 — SLM picks strategy.
      const strategyChosen = await this.pickStrategy(goal, handle, root);
      modelCalls++;

      // Step 2 — search engine runs with goal-derived weights.
      const styleWeights = this.tools.weightsForStyle?.(goal.style) ?? {};
      const searchSpan = handle.startSpan('tool.search', 'TOOL', root);
      searchSpan.setInputs({ strategy: strategyChosen, goal });
      const strategy = getStrategy(strategyChosen);
      const searchResult = searchForBoard({
        size: goal.size,
        language: 'English',
        minWordLength: goal.minWordLength,
        dictionary: [...dictionary],
        strategy,
        maxCandidates: this.config.budget?.maxCandidates ?? 75,
        maxMs: this.config.budget?.maxSearchMs ?? 5000,
        scoreWeights: { ...DEFAULT_WEIGHTS, ...styleWeights } as Partial<ScoreWeights>,
        // Tracer NOT passed through — orchestrator owns the trace; the search
        // engine gets a no-op tracer so we don't double-count the work in
        // MLflow as two parallel traces.
      } as SearchConfig);
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

    const response = await this.config.model.generate({
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userMsg },
      ],
      maxTokens: 24,
      temperature: 0.1,
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
    words: readonly string[],
    handle: ReturnType<typeof this.config.tracer.startTrace>,
    parent: ReturnType<typeof handle.startSpan>
  ): Promise<string> {
    const span = handle.startSpan('model.explain', 'CHAT_MODEL', parent);
    const sample = words
      .filter((w) => w.length >= goal.minWordLength)
      .slice(0, 6);
    const userMsg = [
      `Board (${goal.size}x${goal.size}, row-major): ${board}`,
      `Player-relevant words available: ${playerRelevantWords}`,
      `Longest word length: ${maxWordLength}`,
      `Examples: ${sample.join(', ')}`,
      `Style: ${goal.style ?? 'balanced'}`,
      'Why is this fun?',
    ].join('\n');
    span.setInputs({ system: EXPLAIN_SYSTEM, user: userMsg });

    const response = await this.config.model.generate({
      messages: [
        { role: 'system', content: EXPLAIN_SYSTEM },
        { role: 'user', content: userMsg },
      ],
      maxTokens: 96,
      temperature: 0.4,
    });
    span.setAttribute('elapsed_ms', response.elapsedMs);
    span.setOutputs({ explanation: response.text });
    span.end();
    return response.text.trim();
  }
}
