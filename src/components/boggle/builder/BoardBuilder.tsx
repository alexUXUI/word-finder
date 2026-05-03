import { $, component$, useContext, useTask$ } from '@builder.io/qwik';
import {
  BoardCtx,
  BuilderCtx,
  DictionaryCtx,
  GameCtx,
  SmartCtx,
  AnswersCtx,
  WorkerCtx,
} from '../context';
import {
  loadPrompt,
  loadSavedBoards,
  persistPrompt,
  persistSavedBoards,
} from './storage';
import type { BatchResult, SavedBoard } from './types';

/**
 * Power-user design surface. Slide-in panel from the right.
 *
 * - Free-form prompt → orchestrator goal.description
 * - Run N times: sequential orchestrator runs, captured into a results table
 * - Click a row to load that board into the main game
 * - Star a board to save it; saved boards reload anytime
 * - Persists prompt + saved boards to localStorage
 *
 * `newId` lives inside the `$()` scope it's called from (Qwik's optimizer
 * requires that root-level helpers be exported; defining inline keeps the
 * helper closure-local and serializable).
 */

export const BoardBuilder = component$(() => {
  const builder = useContext(BuilderCtx);
  const smart = useContext(SmartCtx);
  const boardState = useContext(BoardCtx);
  const gameState = useContext(GameCtx);
  const dictionaryState = useContext(DictionaryCtx);
  const answersState = useContext(AnswersCtx);
  const worker = useContext(WorkerCtx);

  // Hydrate persisted state once on mount.
  useTask$(() => {
    if (typeof window === 'undefined') return;
    builder.prompt = loadPrompt();
    builder.savedBoards = loadSavedBoards();
  });

  const open = $(() => {
    builder.open = true;
  });

  const close = $(() => {
    builder.open = false;
  });

  const requestCancel = $(() => {
    builder.cancelRequested = true;
  });

  const updatePrompt = $((value: string) => {
    builder.prompt = value;
    persistPrompt(value);
  });

  const runBatch = $(async (count: number) => {
    if (builder.isRunning) return;
    if (smart.modelStatus !== 'ready') {
      // Trigger Smart Mode load via a Reset on the main panel; for now
      // the panel just notes the requirement.
      return;
    }

    const provider = smart.refs.provider as unknown as
      | import('../intelligence/local-model').LocalModelProvider
      | undefined;
    const tracer = smart.refs.tracer as unknown as
      | import('../generation/trace').Tracer
      | undefined;
    if (!provider || !tracer) return;
    const dict = dictionaryState.dictionary;
    if (!dict.length) return;

    const { Orchestrator } = await import('../intelligence/orchestrator');
    const newId = () =>
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    builder.isRunning = true;
    builder.cancelRequested = false;
    builder.runsCompleted = 0;
    builder.runsTotal = count;
    builder.batchResults = [];

    for (let i = 0; i < count; i++) {
      if (builder.cancelRequested) break;
      try {
        const orchestrator = new Orchestrator({
          model: provider,
          tracer,
          tools: { availableStrategies: ['frequency-weighted'] },
          budget: { maxCandidates: 200, maxSearchMs: 15000 },
        });
        const result = await orchestrator.generateBoard(
          {
            size: boardState.boardSize,
            minWordLength: gameState.minCharLength,
            style: 'long-word-heavy',
            difficulty: 'medium',
            minPlayerRelevantWords: gameState.minWordsPerBoard,
            maxAttempts: 1, // single attempt per run to keep batch wall clock sane
            description: builder.prompt || undefined,
          },
          dict
        );
        const row: BatchResult = {
          id: newId(),
          board: result.board,
          finalScore: result.score.finalScore,
          playerRelevantWords: result.score.playerRelevantWords,
          maxWordLength: result.score.maxWordLength,
          strategy: result.strategyChosen,
          elapsedMs: result.elapsedMs,
          totalCandidatesEvaluated: result.totalCandidatesEvaluated,
          explanation: result.explanation,
          floorMet: result.floorMet,
          createdAt: new Date().toISOString(),
        };
        builder.batchResults = [...builder.batchResults, row];
        builder.runsCompleted = i + 1;
      } catch (err) {
        // Push a failure row so the UI shows it; continue the batch.
        builder.batchResults = [
          ...builder.batchResults,
          {
            id: newId(),
            board: '',
            finalScore: 0,
            playerRelevantWords: 0,
            maxWordLength: 0,
            strategy: '(error)',
            elapsedMs: 0,
            totalCandidatesEvaluated: 0,
            explanation:
              err instanceof Error ? err.message : String(err),
            floorMet: false,
            createdAt: new Date().toISOString(),
          },
        ];
        builder.runsCompleted = i + 1;
      }
    }

    builder.isRunning = false;
    builder.cancelRequested = false;
  });

  const loadIntoGame = $((row: BatchResult | SavedBoard) => {
    if (!row.board || row.board.length === 0) return;
    boardState.chars = [...row.board];
    answersState.answers = [];
    worker.mod?.postMessage({
      language: gameState.language,
      board: boardState.chars,
      minCharLength: gameState.minCharLength,
      isDictionaryLoaded: true,
    });
  });

  const saveBoard = $((row: BatchResult, note: string) => {
    if (!row.board) return;
    const already = builder.savedBoards.some((s) => s.board === row.board);
    if (already) return;
    const newId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const saved: SavedBoard = {
      id: newId,
      board: row.board,
      finalScore: row.finalScore,
      playerRelevantWords: row.playerRelevantWords,
      note,
      isFavorite: false,
      savedAt: new Date().toISOString(),
    };
    builder.savedBoards = [saved, ...builder.savedBoards];
    persistSavedBoards(builder.savedBoards);
  });

  const toggleFavorite = $((id: string) => {
    builder.savedBoards = builder.savedBoards.map((s) =>
      s.id === id ? { ...s, isFavorite: !s.isFavorite } : s
    );
    persistSavedBoards(builder.savedBoards);
  });

  const deleteSaved = $((id: string) => {
    builder.savedBoards = builder.savedBoards.filter((s) => s.id !== id);
    persistSavedBoards(builder.savedBoards);
  });

  const updateSavedNote = $((id: string, note: string) => {
    builder.savedBoards = builder.savedBoards.map((s) =>
      s.id === id ? { ...s, note } : s
    );
    persistSavedBoards(builder.savedBoards);
  });

  return (
    <>
      {/* Toggle button — always visible when panel is closed. */}
      {!builder.open && (
        <button
          type="button"
          data-testid="board-builder-toggle"
          onClick$={open}
          style="position: fixed; top: 50%; right: 0; transform: translateY(-50%); z-index: 100; background: #2563eb; color: white; border: 0; padding: 8px 6px; border-radius: 8px 0 0 8px; cursor: pointer; font-size: 11px; font-weight: 600; writing-mode: vertical-rl; text-orientation: mixed;"
        >
          🛠 Board Builder
        </button>
      )}

      {/* Slide-in panel. Always rendered so transitions work; offscreen when closed. */}
      <aside
        data-testid="board-builder-panel"
        data-open={builder.open ? 'true' : 'false'}
        style={`position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 90vw); background: white; border-left: 1px solid #e5e7eb; box-shadow: -2px 0 16px rgba(0,0,0,0.08); z-index: 110; overflow-y: auto; transform: translateX(${builder.open ? '0' : '100%'}); transition: transform 0.2s ease-out;`}
      >
        <div style="padding: 12px; display: flex; flex-direction: column; gap: 16px; font-size: 13px;">
          {/* Header */}
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <h2 style="margin: 0; font-size: 16px; font-weight: 600; color: #1e3a8a;">
              🛠 Board Builder
            </h2>
            <button
              type="button"
              data-testid="board-builder-close"
              onClick$={close}
              style="background: transparent; border: 0; cursor: pointer; font-size: 18px; padding: 4px 8px;"
              aria-label="Close panel"
            >
              ×
            </button>
          </div>
          <div style="font-size: 12px; color: #555;">
            Steer the SLM with a free-form prompt, run batches, and keep the
            boards you like.
          </div>

          {smart.modelStatus !== 'ready' && (
            <div
              data-testid="board-builder-no-model"
              style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 8px 10px; font-size: 12px;"
            >
              Smart Mode model isn't loaded yet. Click <strong>Reset Board</strong>{' '}
              once on the main panel to load it, then come back.
            </div>
          )}

          {/* Prompt section */}
          <section>
            <label
              for="builder-prompt"
              style="display: block; font-weight: 600; margin-bottom: 4px;"
            >
              Guidance prompt
            </label>
            <textarea
              id="builder-prompt"
              data-testid="board-builder-prompt"
              rows={3}
              value={builder.prompt}
              onInput$={(_, el) => updatePrompt(el.value)}
              placeholder="e.g. 'lots of long words ending in -ing', 'rare letters', 'chaotic mix'"
              style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; resize: vertical;"
            />
            <div style="font-size: 11px; color: #777; margin-top: 4px;">
              Threaded into the orchestrator goal as <code>description</code>.
              The strategy router and explanation step both see this.
            </div>
          </section>

          {/* Run section */}
          <section>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
              <span style="font-weight: 600;">Run</span>
              {[1, 5, 10, 25].map((n) => (
                <button
                  key={n}
                  type="button"
                  data-testid={`board-builder-run-${n}`}
                  disabled={builder.isRunning || smart.modelStatus !== 'ready'}
                  onClick$={() => runBatch(n)}
                  style="padding: 6px 10px; border: 1px solid #2563eb; background: white; color: #2563eb; border-radius: 6px; cursor: pointer; font-size: 12px;"
                >
                  {n}×
                </button>
              ))}
              {builder.isRunning && (
                <button
                  type="button"
                  data-testid="board-builder-cancel"
                  onClick$={requestCancel}
                  style="padding: 6px 10px; border: 1px solid #dc2626; background: #fff; color: #dc2626; border-radius: 6px; cursor: pointer; font-size: 12px;"
                >
                  Cancel
                </button>
              )}
            </div>
            {builder.isRunning && (
              <div
                data-testid="board-builder-progress"
                style="font-size: 12px; color: #555;"
              >
                Running {builder.runsCompleted} / {builder.runsTotal}…
              </div>
            )}
            {builder.batchResults.length > 0 && (
              <div data-testid="board-builder-batch-stats" style="font-size: 11px; color: #555; margin-top: 4px;">
                {(() => {
                  const ws = builder.batchResults.map((r) => r.playerRelevantWords);
                  const max = Math.max(...ws);
                  const min = Math.min(...ws);
                  const mean = (ws.reduce((a, b) => a + b, 0) / ws.length).toFixed(0);
                  return `n=${ws.length}  min=${min}  mean=${mean}  max=${max}`;
                })()}
              </div>
            )}
          </section>

          {/* Results table */}
          {builder.batchResults.length > 0 && (
            <section>
              <div style="font-weight: 600; margin-bottom: 4px;">Batch results</div>
              <div
                data-testid="board-builder-results"
                style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden;"
              >
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                  <thead style="background: #f8fafc; text-align: left;">
                    <tr>
                      <th style="padding: 6px;">#</th>
                      <th style="padding: 6px;">Words</th>
                      <th style="padding: 6px;">Max</th>
                      <th style="padding: 6px;">Score</th>
                      <th style="padding: 6px;">ms</th>
                      <th style="padding: 6px;"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {builder.batchResults.map((r, i) => (
                      <tr
                        key={r.id}
                        data-testid="board-builder-result-row"
                        style={`border-top: 1px solid #f1f5f9; ${
                          r.floorMet ? '' : 'background: #fffbeb;'
                        }`}
                      >
                        <td style="padding: 6px;">{i + 1}</td>
                        <td style="padding: 6px; font-weight: 600;">
                          {r.playerRelevantWords}
                        </td>
                        <td style="padding: 6px;">{r.maxWordLength}</td>
                        <td style="padding: 6px;">{r.finalScore.toFixed(0)}</td>
                        <td style="padding: 6px;">
                          {Math.round(r.elapsedMs)}
                        </td>
                        <td style="padding: 6px; white-space: nowrap;">
                          <button
                            type="button"
                            data-testid="board-builder-result-load"
                            onClick$={() => loadIntoGame(r)}
                            disabled={!r.board}
                            title="Load this board into the game"
                            style="background: transparent; border: 0; cursor: pointer; font-size: 14px; padding: 0 4px;"
                          >
                            ↩
                          </button>
                          <button
                            type="button"
                            data-testid="board-builder-result-save"
                            onClick$={() => saveBoard(r, '')}
                            disabled={!r.board}
                            title="Save this board"
                            style="background: transparent; border: 0; cursor: pointer; font-size: 14px; padding: 0 4px;"
                          >
                            ☆
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Saved boards */}
          <section>
            <div style="font-weight: 600; margin-bottom: 6px;">
              Saved boards ({builder.savedBoards.length})
            </div>
            {builder.savedBoards.length === 0 ? (
              <div
                data-testid="board-builder-saved-empty"
                style="font-size: 12px; color: #777; padding: 8px; background: #f8fafc; border-radius: 6px;"
              >
                Star a row above to save a board here. Saved boards persist
                across sessions.
              </div>
            ) : (
              <ul
                data-testid="board-builder-saved-list"
                style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px;"
              >
                {builder.savedBoards.map((s) => (
                  <li
                    key={s.id}
                    data-testid="board-builder-saved-item"
                    style="border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px; font-size: 12px;"
                  >
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                      <span style="font-weight: 600;">
                        {s.playerRelevantWords} words · score{' '}
                        {s.finalScore.toFixed(0)}
                      </span>
                      <span style="display: inline-flex; gap: 4px;">
                        <button
                          type="button"
                          onClick$={() => toggleFavorite(s.id)}
                          title={
                            s.isFavorite
                              ? 'Remove from favorites'
                              : 'Mark as favorite'
                          }
                          style="background: transparent; border: 0; cursor: pointer; font-size: 14px; padding: 0 4px;"
                        >
                          {s.isFavorite ? '⭐' : '☆'}
                        </button>
                        <button
                          type="button"
                          onClick$={() => loadIntoGame(s)}
                          title="Load into game"
                          style="background: transparent; border: 0; cursor: pointer; font-size: 14px; padding: 0 4px;"
                        >
                          ↩
                        </button>
                        <button
                          type="button"
                          onClick$={() => deleteSaved(s.id)}
                          title="Delete"
                          style="background: transparent; border: 0; cursor: pointer; font-size: 14px; padding: 0 4px;"
                        >
                          🗑
                        </button>
                      </span>
                    </div>
                    <div style="font-family: ui-monospace, monospace; color: #666; margin-top: 4px;">
                      {s.board.toUpperCase()}
                    </div>
                    <input
                      type="text"
                      placeholder="note…"
                      value={s.note}
                      onInput$={(_, el) => updateSavedNote(s.id, el.value)}
                      style="width: 100%; margin-top: 4px; border: 1px solid #e5e7eb; border-radius: 4px; padding: 4px 6px; font-size: 11px;"
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </aside>
    </>
  );
});
