import {
  $,
  component$,
  noSerialize,
  useContext,
  useOnWindow,
  useStore,
} from '@builder.io/qwik';
import type { QwikChangeEvent } from '@builder.io/qwik';
import {
  GameCtx,
  BoardCtx,
  AnswersCtx,
  WorkerCtx,
  SmartCtx,
  DictionaryCtx,
} from '../context';
import { randomBoard } from '../logic/board';
import { SlmPicker } from './SlmPicker';

export const Controls = component$(() => {
  const gameState = useContext(GameCtx);
  const boardState = useContext(BoardCtx);
  const answersState = useContext(AnswersCtx);
  const worker = useContext(WorkerCtx);
  const smart = useContext(SmartCtx);
  const dictionaryState = useContext(DictionaryCtx);

  const constrolsState = useStore({
    isOpen: false,
  });

  const toggleIsOpen = $(() => {
    constrolsState.isOpen = !constrolsState.isOpen;
  });

  useOnWindow(
    'DOMContentLoaded',
    $(() => {
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          constrolsState.isOpen = false;
        }
      });
      window.addEventListener('click', (e) => {
        if (constrolsState.isOpen) {
          const controlFormNode = document.getElementById('controls');
          const controlsButtonNode = document.getElementById('controls-btn');
          if (controlFormNode) {
            if (
              !controlFormNode.contains(e.target as Node) &&
              !controlsButtonNode?.contains(e.target as Node)
            ) {
              constrolsState.isOpen = false;
            }
          }
        }
      });
    })
  );

  const handleBoardCustomization = $(
    async (e: QwikChangeEvent<HTMLInputElement>) => {
      boardState.chars = e.target.value.split('');
      worker.mod?.postMessage({
        language: gameState.language,
        board: boardState.chars,
        minCharLength: gameState.minCharLength,
      });
    }
  );

  const ensureSmartLoaded = $(async (): Promise<boolean> => {
    if (smart.modelStatus === 'ready') return true;
    if (smart.modelStatus === 'loading') {
      // Already in flight; caller should wait.
      return false;
    }
    smart.modelStatus = 'loading';
    smart.modelLoadProgress = 0;
    smart.modelLoadError = undefined;
    try {
      const {
        TransformersJsProvider,
        CloudflareServerProvider,
        selectSlmModel,
        isServerSide,
      } = await import('../intelligence/local-model');
      const { MLflowTracer, NoopTracer } = await import('../generation/trace');
      const sel = selectSlmModel();
      const tier = sel.model;
      smart.slmTier = {
        id: tier.id,
        modelId: tier.modelId,
        approxSizeMb: tier.approxSizeMb,
        displayName: tier.displayName,
        reason: sel.reason,
      };
      // Server-side tier doesn't load anything in the browser; instantiate
      // the proxy provider and skip straight to ready.
      const provider = isServerSide(tier)
        ? new CloudflareServerProvider({ modelId: tier.modelId })
        : new TransformersJsProvider({ modelId: tier.modelId });
      smart.refs.provider = noSerialize(provider);

      // Only emit traces to MLflow when running on a localhost dev box.
      // From a deployed origin Chrome's Private Network Access policy
      // would (a) prompt the user about localhost access and (b) block
      // the POST via CORS — neither belongs in a production page.
      const host =
        typeof window !== 'undefined' ? window.location.hostname : '';
      const isLocalhost =
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '0.0.0.0';
      smart.refs.tracer = noSerialize(
        isLocalhost
          ? new MLflowTracer({
              experimentName: 'word-finder-player',
              endpoint: 'http://localhost:5001/traces',
              silent: true,
            })
          : NoopTracer
      );
      // CloudflareServerProvider.load() is a no-op; TransformersJsProvider
      // streams real progress.
      await provider.load((p) => {
        if (p.total && p.loaded) {
          smart.modelLoadProgress = (p.loaded / p.total) * 100;
        } else if (p.status === 'ready') {
          smart.modelLoadProgress = 100;
        }
      });
      smart.modelStatus = 'ready';
      smart.modelLoadProgress = 100;
      return true;
    } catch (err) {
      smart.modelStatus = 'error';
      smart.modelLoadError = err instanceof Error ? err.message : String(err);
      return false;
    }
  });

  const handleRandomizeBoard = $(async () => {
    if (smart.enabled) {
      // Smart Mode (the default): lazy-load the model on first click,
      // then run the orchestrator. If load fails, fall back to legacy.
      const ready = await ensureSmartLoaded();
      if (!ready) {
        if (smart.modelStatus === 'error') {
          // Drop to legacy single-shot so the player still gets a board.
          boardState.chars = randomBoard(
            gameState.language,
            boardState.boardSize
          ).split('');
          answersState.answers = [];
          worker.mod?.postMessage({
            language: gameState.language,
            board: boardState.chars,
            minCharLength: gameState.minCharLength,
          });
        }
        return;
      }

      smart.generationStatus = 'running';
      smart.generationStage = 'planning';
      smart.bannerDismissed = false;
      smart.lastExplanation = undefined;
      smart.narration = [];
      smart.liveTokens = '';
      smart.searchProgress = undefined;
      try {
        const { runPipelineBatch, pickBest } = await import(
          '../intelligence/pipeline/batch-runner'
        );
        const { initializePipelines } = await import(
          '../intelligence/pipelines'
        );
        const { getChampion, getPipeline } = await import(
          '../intelligence/pipeline/registry'
        );
        initializePipelines();
        const champion =
          getChampion() ?? getPipeline('p01-smart-router');
        if (!champion) {
          throw new Error('No champion pipeline registered');
        }
        const provider = smart.refs.provider as unknown as
          | import('../intelligence/local-model').LocalModelProvider
          | undefined;
        const tracer = smart.refs.tracer as unknown as
          | import('../generation/trace').Tracer
          | undefined;
        if (!provider || !tracer) {
          throw new Error('SLM or tracer not initialized');
        }
        const dict = dictionaryState.dictionary;
        if (!dict.length) {
          throw new Error('Dictionary not loaded yet');
        }
        smart.generationStage = 'generating';

        // Multi-run: champion pipeline runs N times. Best becomes the live
        // board; all N populate the dashboard. Live progress fires after
        // each completed run.
        const totalRuns = Math.max(1, gameState.attemptsPerReset || 10);
        smart.batchProgress = { completed: 0, total: totalRuns, bestSoFar: 0 };
        smart.lastBatch = [];

        const allResults = await runPipelineBatch(
          champion,
          {
            goal: {
              size: boardState.boardSize,
              minWordLength: gameState.minCharLength,
              language: gameState.language,
              style: 'long-word-heavy',
              difficulty: 'medium',
              minPlayerRelevantWords: gameState.minWordsPerBoard,
            },
            dictionary: dict,
            model: provider,
            tracer,
            callbacks: {
              onNarrate: (line) => {
                smart.narration = [...smart.narration, line];
                smart.liveTokens = '';
                if (line.startsWith('🤔') || line.startsWith('🔍')) {
                  smart.generationStage = line;
                } else if (line.startsWith('💬')) {
                  smart.generationStage = 'explaining';
                }
              },
              onTokenStream: (_chunk, accumulator) => {
                smart.liveTokens = accumulator;
              },
              onSearchProgress: (info) => {
                smart.searchProgress = {
                  index: info.index,
                  total: info.total,
                  bestScore: info.bestScore,
                  playerRelevantWords: info.playerRelevantWords,
                };
              },
            },
          },
          {
            runs: totalRuns,
            onRunComplete: (r, idx, _all) => {
              // Reset narration between runs so the banner shows the
              // CURRENT run only — without this, 10 runs × ~6 lines each
              // pile up and shove the board offscreen.
              smart.narration = [];
              smart.liveTokens = '';
              smart.searchProgress = undefined;
              smart.lastBatch = [
                ...(smart.lastBatch ?? []),
                {
                  idx,
                  pipelineId: champion.id,
                  board: r.board,
                  finalScore: r.score.finalScore,
                  playerRelevantWords: r.score.playerRelevantWords,
                  maxWordLength: r.score.maxWordLength,
                  averageWordLength: r.score.averageWordLength,
                  vowelRatio: r.score.vowelRatio,
                  letterEntropy: r.score.letterEntropy,
                  prefixDiversity: r.score.prefixDiversity,
                  strategy: r.strategy,
                  candidatesEvaluated: r.candidatesEvaluated,
                  mutationsApplied: r.mutationsApplied,
                  modelCalls: r.modelCalls,
                  elapsedMs: r.elapsedMs,
                  floorMet: r.floorMet,
                  criticScore: r.criticScore,
                  explanation: r.explanation,
                },
              ];
              smart.batchProgress = {
                completed: idx + 1,
                total: totalRuns,
                bestSoFar: Math.max(
                  smart.batchProgress?.bestSoFar ?? 0,
                  r.score.playerRelevantWords
                ),
              };
            },
          }
        );

        const result = pickBest(allResults);
        boardState.chars = [...result.board];
        answersState.answers = [];
        smart.lastExplanation = result.explanation;
        smart.lastStrategy = result.strategy;
        smart.lastFinalScore = result.score.finalScore;
        smart.lastModelCalls = allResults.reduce((s, r) => s + r.modelCalls, 0);
        smart.lastElapsedMs = allResults.reduce((s, r) => s + r.elapsedMs, 0);
        smart.lastFloorMet = result.floorMet;
        smart.lastAttempts = allResults.length;
        smart.lastFloorTarget = gameState.minWordsPerBoard;
        smart.lastPlayerRelevantWords = result.score.playerRelevantWords;
        smart.lastTotalCandidates = allResults.reduce(
          (s, r) => s + r.candidatesEvaluated,
          0
        );
        smart.generationStatus = 'complete';
        smart.generationStage = undefined;
        smart.batchProgress = undefined;
        // Don't auto-pop the dashboard — the right-edge "📊 Stats" tab is
        // always visible after a batch completes; player opens it when
        // they want to. Auto-opening would cover the freshly-loaded
        // board the moment they hit Reset.
        worker.mod?.postMessage({
          language: gameState.language,
          board: boardState.chars,
          minCharLength: gameState.minCharLength,
          isDictionaryLoaded: true,
        });
        const tracerWithFlush = tracer as unknown as { flush?: () => Promise<void> };
        tracerWithFlush.flush?.().catch(() => {
          /* swallow — banner doesn't surface trace flush errors */
        });
      } catch (err) {
        smart.generationStatus = 'error';
        smart.generationStage = err instanceof Error ? err.message : String(err);
      }
      return;
    }

    // Smart Mode off: the original frequency-weighted single-shot.
    boardState.chars = randomBoard(
      gameState.language,
      boardState.boardSize
    ).split('');
    answersState.answers = [];
    worker.mod?.postMessage({
      language: gameState.language,
      board: boardState.chars,
      minCharLength: gameState.minCharLength,
    });
  });

  const handleToggleSmartMode = $(async () => {
    if (smart.modelStatus === 'loading') return;
    smart.enabled = !smart.enabled;
  });

  const handlePickModel = $(async (value: string) => {
    if (smart.modelStatus === 'loading') return;
    const { setSlmPreference } = await import(
      '../intelligence/local-model'
    );
    setSlmPreference(value === 'auto' ? null : value);
    // Drop the loaded provider so the next Reset re-loads with the new
    // model. Status returns to idle; banner shows the new tier.
    smart.refs.provider = undefined;
    smart.refs.tracer = undefined;
    smart.modelStatus = 'idle';
    smart.modelLoadProgress = 0;
    smart.modelLoadError = undefined;
    smart.slmTier = undefined;
  });

  const handleChangeLanguage = $((e: QwikChangeEvent<HTMLSelectElement>) => {
    const { value } = e.target;
    gameState.language = value;
    boardState.chars = randomBoard(value, boardState.boardSize).split('');
    worker.mod?.postMessage({
      language: gameState.language,
      board: boardState.chars,
      minCharLength: gameState.minCharLength,
    });
  });

  const handleChangeBoardSize = $((e: QwikChangeEvent<HTMLInputElement>) => {
    const { valueAsNumber } = e.target;
    boardState.boardSize = valueAsNumber;
    boardState.chars = randomBoard(gameState.language, valueAsNumber).split('');
    worker.mod?.postMessage({
      language: gameState.language,
      board: boardState.chars,
      minCharLength: gameState.minCharLength,
    });
  });

  const handleChangeMinCharLength = $(
    (e: QwikChangeEvent<HTMLInputElement>) => {
      gameState.minCharLength = e.target.valueAsNumber;
    }
  );

  const handleChangeMinWordsPerBoard = $(
    (e: QwikChangeEvent<HTMLInputElement>) => {
      const v = e.target.valueAsNumber;
      // Defensive: clamp to a sane range. Negative or NaN means "no floor".
      gameState.minWordsPerBoard = Number.isFinite(v) && v >= 0 ? v : 0;
    }
  );

  const handleChangeAttemptsPerReset = $(
    (e: QwikChangeEvent<HTMLInputElement>) => {
      const v = e.target.valueAsNumber;
      // Range [1, 50] — too many runs and Reset takes minutes; too few
      // defeats the dashboard purpose.
      const clamped = Number.isFinite(v) ? Math.max(1, Math.min(50, v)) : 10;
      gameState.attemptsPerReset = clamped;
    }
  );

  const answersLength = answersState.answers.filter(
    (word) => word.length >= gameState.minCharLength
  ).length;

  return (
    <div class="w-full top-0 z-50">
      <div class="glass h-[40px] flex items-center justify-center">
        <h1
          data-testid="app-title"
          class="text-center text-xl text-blue-900 font-medium m-0 py-2"
        >
          Word Finder
        </h1>
      </div>
      <div class="glass flex items-center h-[50px] w-full m-auto">
        <div class="m-auto w-full flex max-w-[420px]">
          <div class="w-[33.3%] flex justify-center">
            <button
              id="controls-btn"
              data-testid="controls-toggle"
              data-controls-open={constrolsState.isOpen ? 'true' : 'false'}
              class="px-2 text-[14px] border-2 bg-white h-[40px] border-blue-800 hover:bg-blue-200 rounded-md "
              onClick$={toggleIsOpen}
            >
              {constrolsState.isOpen ? 'Close' : 'Open'} Controls
            </button>
          </div>
          <div class="w-[33.3%] flex justify-center">
            <button
              data-testid="reset-board"
              class="px-2 text-[14px] border-2 bg-white h-[40px] border-blue-800 hover:bg-blue-200 rounded-md "
              disabled={smart.generationStatus === 'running'}
              onClick$={handleRandomizeBoard}
              type="button"
            >
              {smart.generationStatus === 'running'
                ? 'Thinking…'
                : smart.enabled && smart.modelStatus === 'ready'
                ? '✨ Reset (Smart)'
                : 'Reset Board'}
            </button>
          </div>
          <div class="w-[33.3%] flex justify-center">
            <div
              data-testid="answers-count"
              data-answers-count={answersLength}
              class="text-[14px] rounded-md border-2 border-blue-900 bg-blue-50  h-[40px] w-[120px] flex items-center justify-start px-2"
            >
              Answers:{'  '}
              <span data-testid="answers-count-value" class="text-[14px] rounded-sm">
                {answersLength > 0 ? ` ${answersLength}` : ''}
              </span>
            </div>
          </div>
        </div>
      </div>
      {constrolsState.isOpen ? (
        <form
          id="controls"
          data-testid="controls-panel"
          class="glass border-b-2 border-[#dfdfdf] fixed z-50 w-full m-auto px-2 flex justify-center"
        >
          <fieldset class="w-full p-2 rounded-md border-blue-900 flex flex-wrap justify-evenly max-w-[420px]">
            <div class="flex flex-col my-[10px]">
              <label class="text-[14px]" for="language">
                Language
              </label>
              <select
                id="language"
                data-testid="language-select"
                class="pl-[2px] rounded-md w-[10ch] h-[40px] border-2 border-blue-900"
                onChange$={handleChangeLanguage}
                value={gameState.language}
              >
                <option value="English">English</option>
              </select>
            </div>
            <div class="flex flex-col my-[10px]">
              <label for="min-char-length" class="text-[14px]">
                Word Size
              </label>
              <input
                id="min-char-length"
                data-testid="word-size-input"
                type="number"
                onChange$={handleChangeMinCharLength}
                value={gameState.minCharLength}
                class="pl-2 rounded-md w-[70px] h-[40px] border-2 border-blue-900"
              />
            </div>
            <div class="flex flex-col my-[10px]">
              <label
                for="min-words-per-board"
                class="text-[14px]"
                title="Smart Mode hard floor: minimum number of player-relevant words a generated board must contain. Smart retries up to 3× to satisfy."
              >
                Min Words
              </label>
              <input
                id="min-words-per-board"
                data-testid="min-words-input"
                type="number"
                min="0"
                step="10"
                onChange$={handleChangeMinWordsPerBoard}
                value={gameState.minWordsPerBoard}
                class="pl-2 rounded-md w-[80px] h-[40px] border-2 border-blue-900"
              />
            </div>
            <div class="flex flex-col my-[10px]">
              <label
                for="attempts-per-reset"
                class="text-[14px]"
                title="Number of independent pipeline runs per Reset. The dashboard shows all runs ranked; the player gets the best."
              >
                Attempts
              </label>
              <input
                id="attempts-per-reset"
                data-testid="attempts-per-reset-input"
                type="number"
                min="1"
                max="50"
                step="1"
                onChange$={handleChangeAttemptsPerReset}
                value={gameState.attemptsPerReset}
                class="pl-2 rounded-md w-[70px] h-[40px] border-2 border-blue-900"
              />
            </div>
            <div class="flex flex-col my-[10px]">
              <label class="text-[14px]" for="board-size">
                Board Size
              </label>
              <input
                id="board-size"
                data-testid="board-size-input"
                type="number"
                onChange$={handleChangeBoardSize}
                value={boardState.boardSize}
                class="pl-2 rounded-md w-[70px] h-[40px] border-2 border-blue-900"
              />
            </div>
            <div class="flex flex-col my-[10px]">
              <label class="text-[14px] w-fit" for="customize">
                Customize
              </label>
              <input
                id="customize"
                data-testid="customize-input"
                type="text"
                class="w-[25ch] tracking-wide h-[40px] rounded-md text-center border-2 border-blue-900"
                placeholder="customize board"
                value={boardState.chars.join('')}
                onChange$={handleBoardCustomization}
              />
            </div>
            <div class="flex flex-col my-[10px] w-full">
              <label class="text-[14px] w-fit" for="smart-mode">
                Smart Mode (on-device SLM)
              </label>
              <button
                id="smart-mode"
                data-testid="smart-mode-toggle"
                data-smart-enabled={smart.enabled ? 'true' : 'false'}
                data-smart-model-status={smart.modelStatus}
                data-slm-tier={smart.slmTier?.id ?? 'unselected'}
                type="button"
                onClick$={handleToggleSmartMode}
                class="text-[13px] rounded-md border-2 border-blue-900 bg-white h-[36px] px-2"
              >
                {smart.modelStatus === 'loading'
                  ? `Loading ${smart.slmTier?.displayName ?? 'model'} (${Math.round(smart.modelLoadProgress)}%)…`
                  : smart.modelStatus === 'error'
                  ? `Error: ${smart.modelLoadError ?? 'unknown'} (click to retry)`
                  : smart.enabled && smart.modelStatus === 'ready'
                  ? `✨ Smart Mode: ON · ${smart.slmTier?.displayName ?? ''}`
                  : smart.enabled
                  ? '✨ Smart Mode: ON (model loads on first reset)'
                  : 'Smart Mode: OFF'}
              </button>
              {smart.enabled && smart.modelStatus === 'idle' && (
                <span
                  data-testid="smart-mode-tier-hint"
                  style="font-size:11px; color:#666; margin-top:2px;"
                >
                  On first reset, downloads the chosen SLM, then uses it
                  locally. Smaller models are safer on mobile.
                </span>
              )}
              {smart.slmTier && smart.modelStatus === 'ready' && (
                <span
                  data-testid="smart-mode-tier-info"
                  style="font-size:11px; color:#666; margin-top:2px;"
                >
                  Loaded: <strong>{smart.slmTier.displayName}</strong>
                  {' '}({smart.slmTier.approxSizeMb} MB) — picked via {smart.slmTier.reason}
                </span>
              )}
            </div>
            <div class="flex flex-col my-[10px] w-full">
              <label class="text-[14px] w-fit" for="slm-picker">
                SLM Model
              </label>
              <SlmPicker
                disabled={smart.modelStatus === 'loading'}
                onPick$={handlePickModel}
              />
              <span
                data-testid="slm-picker-hint"
                style="font-size:11px; color:#666; margin-top:2px;"
              >
                Auto picks based on your device's User-Agent. Override to
                test which models load on your phone — switching reloads
                the model on the next Reset.
              </span>
            </div>
          </fieldset>
        </form>
      ) : null}
    </div>
  );
});
