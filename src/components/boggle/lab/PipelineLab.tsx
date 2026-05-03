import { $, component$, useContext, useBrowserVisibleTask$, useSignal } from '@builder.io/qwik';
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
  loadCardScores,
  loadChampion,
  loadPrompt,
  loadSavedBoards,
  persistCardScores,
  persistChampion,
  persistPrompt,
  persistSavedBoards,
} from './storage';
import type { BatchRow, BenchPair, PipelineCardScores, SavedBoard } from './types';

/**
 * Pipeline Lab — the AI engineering surface. Replaces the old Board Builder.
 *
 * Three tabs:
 *   - **Pipelines** — card per registered pipeline, with last leaderboard
 *     scores, Pareto position, and a "promote to champion" action.
 *   - **Bench** — pick champion vs challenger, run side-by-side N runs on
 *     the current goal, see distributions overlaid + per-metric delta.
 *   - **Saved** — saved/favorited boards, persists across sessions.
 *
 * The free-form prompt that used to live in the Builder lives here too —
 * it threads as `goal.description` for the runs that this Lab kicks off.
 *
 * Smart Mode (player UI Reset Board) runs whichever pipeline is the current
 * **champion**. The Lab is how new champions get crowned.
 */

export const PipelineLab = component$(() => {
  const builder = useContext(BuilderCtx);
  const smart = useContext(SmartCtx);
  const boardState = useContext(BoardCtx);
  const gameState = useContext(GameCtx);
  const dictionaryState = useContext(DictionaryCtx);
  const answersState = useContext(AnswersCtx);
  const worker = useContext(WorkerCtx);

  const tab = useSignal<'pipelines' | 'bench' | 'saved'>('pipelines');
  const championId = useSignal<string | null>(null);
  const challengerId = useSignal<string>('p02-slm-mutator');
  const cardScores = useSignal<PipelineCardScores[]>([]);
  const pipelines = useSignal<{ id: string; description: string; version: string }[]>([]);
  const bench = useSignal<BenchPair | null>(null);
  // Local override for the prompt that gets threaded into pipeline runs.
  const prompt = useSignal<string>('');

  // Hydrate state on mount. useBrowserVisibleTask$ runs in the browser only,
  // unlike useTask$ which fires server-side during SSR and not on resume.
  // Dynamic imports of intelligence/pipelines/* must happen client-side
  // because they pull in noSerialize'd state.
  useBrowserVisibleTask$(async () => {
    builder.savedBoards = (loadSavedBoards() as unknown as typeof builder.savedBoards) ?? [];
    prompt.value = loadPrompt();
    cardScores.value = loadCardScores();
    championId.value = loadChampion() ?? 'p01-smart-router';

    // Lazy import the pipeline registry so the Lab doesn't pay the import
    // cost on first paint when it's closed.
    const { listPipelines, setChampion } = await import(
      '../intelligence/pipeline/registry'
    );
    const { initializePipelines } = await import(
      '../intelligence/pipelines'
    );
    initializePipelines();
    pipelines.value = listPipelines().map((p) => ({
      id: p.id,
      description: p.description,
      version: p.version,
    }));
    if (championId.value) {
      try {
        setChampion(championId.value);
      } catch {
        /* champion id may be stale; ignore */
      }
    }
  });

  const open = $(() => {
    builder.open = true;
  });
  const close = $(() => {
    builder.open = false;
  });

  const setTab = $((t: 'pipelines' | 'bench' | 'saved') => {
    tab.value = t;
  });

  const promote = $(async (id: string) => {
    const { setChampion } = await import('../intelligence/pipeline/registry');
    setChampion(id);
    championId.value = id;
    persistChampion(id);
  });

  const updatePrompt = $((v: string) => {
    prompt.value = v;
    persistPrompt(v);
  });

  const cancelBench = $(() => {
    if (bench.value) {
      bench.value = { ...bench.value, cancelRequested: true };
    }
  });

  // Run a single pipeline N times against the current goal. Used by both the
  // single-pipeline run buttons (on a card) and the bench tab.
  const runPipelineN = $(
    async (pipelineId: string, n: number): Promise<BatchRow[]> => {
      if (smart.modelStatus !== 'ready') return [];
      const provider = smart.refs.provider as unknown as
        | import('../intelligence/local-model').LocalModelProvider
        | undefined;
      const tracer = smart.refs.tracer as unknown as
        | import('../generation/trace').Tracer
        | undefined;
      if (!provider || !tracer) return [];
      const dict = dictionaryState.dictionary;
      if (!dict.length) return [];

      const { runPipeline } = await import('../intelligence/pipeline/runner');
      const { getPipeline } = await import('../intelligence/pipeline/registry');
      const pipeline = getPipeline(pipelineId);
      if (!pipeline) return [];
      const out: BatchRow[] = [];
      for (let i = 0; i < n; i++) {
        try {
          const result = await runPipeline(pipeline, {
            goal: {
              size: boardState.boardSize,
              minWordLength: gameState.minCharLength,
              language: gameState.language,
              minPlayerRelevantWords: gameState.minWordsPerBoard,
              style: 'long-word-heavy',
              description: prompt.value || undefined,
              maxAttempts: 1,
            },
            dictionary: dict,
            model: provider,
            tracer,
          });
          out.push({
            id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            pipelineId,
            board: result.board,
            finalScore: result.score.finalScore,
            playerRelevantWords: result.score.playerRelevantWords,
            maxWordLength: result.score.maxWordLength,
            strategy: result.strategy,
            elapsedMs: result.elapsedMs,
            candidatesEvaluated: result.candidatesEvaluated,
            mutationsApplied: result.mutationsApplied,
            modelCalls: result.modelCalls,
            explanation: result.explanation,
            floorMet: result.floorMet,
            createdAt: new Date().toISOString(),
          });
        } catch (err) {
          out.push({
            id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            pipelineId,
            board: '',
            finalScore: 0,
            playerRelevantWords: 0,
            maxWordLength: 0,
            strategy: '(error)',
            elapsedMs: 0,
            candidatesEvaluated: 0,
            mutationsApplied: 0,
            modelCalls: 0,
            explanation: err instanceof Error ? err.message : String(err),
            floorMet: false,
            createdAt: new Date().toISOString(),
          });
        }
      }
      return out;
    }
  );

  const runBench = $(async (n: number) => {
    if (smart.modelStatus !== 'ready') return;
    const champ = championId.value ?? 'p01-smart-router';
    const chall = challengerId.value;
    if (champ === chall) return;

    bench.value = {
      championId: champ,
      challengerId: chall,
      goalId: 'default-balanced',
      runs: n,
      championResults: [],
      challengerResults: [],
      isRunning: true,
      cancelRequested: false,
      completed: 0,
      total: n * 2,
    };

    // Interleave for fair comparison: champ_i, chall_i, champ_{i+1}, ...
    for (let i = 0; i < n; i++) {
      if (bench.value?.cancelRequested) break;
      const champRow = await runPipelineN(champ, 1);
      bench.value = {
        ...bench.value!,
        championResults: [...bench.value!.championResults, ...champRow],
        completed: bench.value!.completed + 1,
      };
      if (bench.value?.cancelRequested) break;
      const challRow = await runPipelineN(chall, 1);
      bench.value = {
        ...bench.value!,
        challengerResults: [...bench.value!.challengerResults, ...challRow],
        completed: bench.value!.completed + 1,
      };
    }
    bench.value = { ...bench.value!, isRunning: false };

    // Update card scores from this fresh comparison so the cards reflect
    // current numbers.
    const updateCard = (id: string, rows: BatchRow[]): PipelineCardScores => {
      const ws = rows.map((r) => r.playerRelevantWords).sort((a, b) => a - b);
      const mean = ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : 0;
      const p = (q: number) => (ws.length ? ws[Math.floor(q * (ws.length - 1))] : 0);
      const elapsed = rows.length ? rows.reduce((a, r) => a + r.elapsedMs, 0) / rows.length : 0;
      return {
        pipelineId: id,
        perGoal: {
          'default-balanced': {
            mean: Math.round(mean),
            p10: p(0.1),
            p90: p(0.9),
            runs: rows.length,
            elapsedMs: Math.round(elapsed),
          },
        },
      };
    };
    const newScores = [
      ...cardScores.value.filter((s) => s.pipelineId !== champ && s.pipelineId !== chall),
      updateCard(champ, bench.value.championResults),
      updateCard(chall, bench.value.challengerResults),
    ];
    cardScores.value = newScores;
    persistCardScores(newScores);
  });

  const loadBoardIntoGame = $((row: BatchRow | SavedBoard) => {
    if (!row.board) return;
    boardState.chars = [...row.board];
    answersState.answers = [];
    worker.mod?.postMessage({
      language: gameState.language,
      board: boardState.chars,
      minCharLength: gameState.minCharLength,
      isDictionaryLoaded: true,
    });
  });

  const saveBoard = $((row: BatchRow) => {
    if (!row.board) return;
    const already = (builder.savedBoards as unknown as SavedBoard[]).some(
      (s) => s.board === row.board
    );
    if (already) return;
    const saved: SavedBoard = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      pipelineId: row.pipelineId,
      board: row.board,
      finalScore: row.finalScore,
      playerRelevantWords: row.playerRelevantWords,
      note: '',
      isFavorite: false,
      savedAt: new Date().toISOString(),
    };
    const next = [saved, ...(builder.savedBoards as unknown as SavedBoard[])];
    builder.savedBoards = next as unknown as typeof builder.savedBoards;
    persistSavedBoards(next);
  });

  const findCard = (id: string): PipelineCardScores | undefined =>
    cardScores.value.find((c) => c.pipelineId === id);

  const meanOf = (rows: BatchRow[]): number =>
    rows.length ? rows.reduce((a, r) => a + r.playerRelevantWords, 0) / rows.length : 0;

  return (
    <>
      {!builder.open && (
        <button
          type="button"
          data-testid="pipeline-lab-toggle"
          onClick$={open}
          style="position: fixed; top: 50%; right: 0; transform: translateY(-50%); z-index: 100; background: #2563eb; color: white; border: 0; padding: 8px 6px; border-radius: 8px 0 0 8px; cursor: pointer; font-size: 11px; font-weight: 600; writing-mode: vertical-rl; text-orientation: mixed;"
        >
          🧪 Pipeline Lab
        </button>
      )}

      <aside
        data-testid="pipeline-lab-panel"
        data-open={builder.open ? 'true' : 'false'}
        style={`position: fixed; top: 0; right: 0; bottom: 0; width: min(560px, 95vw); background: white; border-left: 1px solid #e5e7eb; box-shadow: -2px 0 16px rgba(0,0,0,0.08); z-index: 110; overflow-y: auto; transform: translateX(${builder.open ? '0' : '100%'}); transition: transform 0.2s ease-out;`}
      >
        <div style="padding: 12px; display: flex; flex-direction: column; gap: 12px; font-size: 13px;">
          <header style="display: flex; align-items: center; justify-content: space-between;">
            <h2 style="margin: 0; font-size: 16px; font-weight: 600; color: #1e3a8a;">
              🧪 Pipeline Lab
            </h2>
            <button
              type="button"
              data-testid="pipeline-lab-close"
              onClick$={close}
              style="background: transparent; border: 0; cursor: pointer; font-size: 18px; padding: 4px 8px;"
              aria-label="Close panel"
            >
              ×
            </button>
          </header>

          {/* Champion banner */}
          <div
            data-testid="pipeline-lab-champion"
            data-champion-id={championId.value ?? ''}
            style="background: #ecfeff; border-left: 4px solid #0891b2; padding: 8px 10px; font-size: 12px;"
          >
            <strong>Champion:</strong>{' '}
            <code data-testid="pipeline-lab-champion-id">{championId.value ?? '(none)'}</code>{' '}
            — what Smart Mode runs in the player UI.
          </div>

          {/* Tabs */}
          <nav role="tablist" style="display: flex; gap: 4px; border-bottom: 1px solid #e5e7eb;">
            {[
              { id: 'pipelines', label: 'Pipelines' },
              { id: 'bench', label: 'Bench' },
              { id: 'saved', label: 'Saved' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                data-testid={`pipeline-lab-tab-${t.id}`}
                aria-selected={tab.value === t.id ? 'true' : 'false'}
                onClick$={() => setTab(t.id as 'pipelines' | 'bench' | 'saved')}
                style={`padding: 8px 12px; border: 0; cursor: pointer; background: ${tab.value === t.id ? 'white' : '#f8fafc'}; font-weight: ${tab.value === t.id ? '600' : '400'}; border-bottom: 2px solid ${tab.value === t.id ? '#2563eb' : 'transparent'}; font-size: 13px;`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {/* Prompt — visible across all tabs since it threads into runs */}
          <section>
            <label style="display: block; font-weight: 600; margin-bottom: 4px; font-size: 12px;">
              Goal description (threads into pipeline runs)
            </label>
            <textarea
              data-testid="pipeline-lab-prompt"
              rows={2}
              value={prompt.value}
              onInput$={(_, el) => updatePrompt(el.value)}
              placeholder="e.g. 'long words ending in -ing', 'rare letters', 'chaotic mix'"
              style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12px; resize: vertical;"
            />
          </section>

          {smart.modelStatus !== 'ready' && (
            <div
              data-testid="pipeline-lab-no-model"
              style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 8px 10px; font-size: 12px;"
            >
              SLM not loaded. Click <strong>Reset Board</strong> in the main panel to load it, then come back to run pipelines that use a model.
            </div>
          )}

          {/* Pipelines tab */}
          {tab.value === 'pipelines' && (
            <section data-testid="pipeline-lab-pipelines">
              <div style="display: flex; flex-direction: column; gap: 8px;">
                {pipelines.value.map((p) => {
                  const card = findCard(p.id);
                  const isChamp = championId.value === p.id;
                  return (
                    <article
                      key={p.id}
                      data-testid="pipeline-card"
                      data-pipeline-id={p.id}
                      style={`border: 1px solid ${isChamp ? '#0891b2' : '#e5e7eb'}; border-radius: 8px; padding: 10px; background: ${isChamp ? '#ecfeff' : 'white'};`}
                    >
                      <header style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                        <div>
                          <code style="font-weight: 600; font-size: 13px;">{p.id}</code>
                          <span style="margin-left: 6px; color: #777; font-size: 11px;">
                            {`v${p.version}`}
                          </span>
                          {isChamp ? (
                            <span style="margin-left: 6px; background: #0891b2; color: white; font-size: 10px; padding: 1px 6px; border-radius: 999px;">
                              champion
                            </span>
                          ) : null}
                        </div>
                        <span style="display: inline-flex; gap: 4px;">
                          <button
                            type="button"
                            data-testid="pipeline-card-run"
                            disabled={smart.modelStatus !== 'ready'}
                            onClick$={async () => {
                              const rows = await runPipelineN(p.id, 5);
                              // Update local card score from this fresh run.
                              const ws = rows.map((r) => r.playerRelevantWords).sort((a, b) => a - b);
                              const mean = ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : 0;
                              const next = [
                                ...cardScores.value.filter((s) => s.pipelineId !== p.id),
                                {
                                  pipelineId: p.id,
                                  perGoal: {
                                    'default-balanced': {
                                      mean: Math.round(mean),
                                      p10: ws[Math.floor(0.1 * (ws.length - 1))] ?? 0,
                                      p90: ws[Math.floor(0.9 * (ws.length - 1))] ?? 0,
                                      runs: ws.length,
                                      elapsedMs: Math.round(
                                        rows.reduce((a, r) => a + r.elapsedMs, 0) /
                                          Math.max(1, rows.length)
                                      ),
                                    },
                                  },
                                },
                              ];
                              cardScores.value = next;
                              persistCardScores(next);
                            }}
                            style="padding: 4px 8px; border: 1px solid #2563eb; background: white; color: #2563eb; border-radius: 4px; cursor: pointer; font-size: 11px;"
                          >
                            Run 5×
                          </button>
                          {!isChamp && (
                            <button
                              type="button"
                              data-testid="pipeline-card-promote"
                              onClick$={() => promote(p.id)}
                              style="padding: 4px 8px; border: 1px solid #0891b2; background: white; color: #0891b2; border-radius: 4px; cursor: pointer; font-size: 11px;"
                            >
                              Promote to champion
                            </button>
                          )}
                        </span>
                      </header>
                      <p style="margin: 6px 0 0 0; font-size: 12px; color: #444;">
                        {p.description}
                      </p>
                      {card ? (
                        <div
                          data-testid="pipeline-card-scores"
                          style="margin-top: 6px; font-size: 11px; color: #555; font-family: ui-monospace, monospace;"
                        >
                          {Object.entries(card.perGoal).map(([g, s]) => (
                            <div key={g}>
                              {`${g}: mean=${s.mean}  p10=${s.p10}  p90=${s.p90}  runs=${s.runs}  ms=${s.elapsedMs}`}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style="margin-top: 6px; font-size: 11px; color: #999;">
                          No bench data yet. Click Run 5× to populate.
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {/* Bench tab */}
          {tab.value === 'bench' && (
            <section data-testid="pipeline-lab-bench" style="display: flex; flex-direction: column; gap: 12px;">
              <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                <label style="font-size: 12px;">Champion</label>
                <select
                  data-testid="bench-champion-select"
                  value={championId.value ?? ''}
                  onChange$={(_, el) => {
                    championId.value = el.value;
                    persistChampion(el.value);
                  }}
                  style="font-size: 12px; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px;"
                >
                  {pipelines.value.map((p) => (
                    <option key={p.id} value={p.id}>{p.id}</option>
                  ))}
                </select>
                <label style="font-size: 12px;">vs.</label>
                <select
                  data-testid="bench-challenger-select"
                  value={challengerId.value}
                  onChange$={(_, el) => {
                    challengerId.value = el.value;
                  }}
                  style="font-size: 12px; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px;"
                >
                  {pipelines.value
                    .filter((p) => p.id !== championId.value)
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.id}</option>
                    ))}
                </select>
                {[5, 10, 25].map((n) => (
                  <button
                    key={n}
                    type="button"
                    data-testid={`bench-run-${n}`}
                    disabled={smart.modelStatus !== 'ready' || bench.value?.isRunning}
                    onClick$={() => runBench(n)}
                    style="padding: 4px 10px; border: 1px solid #2563eb; background: white; color: #2563eb; border-radius: 4px; cursor: pointer; font-size: 12px;"
                  >
                    Run {n} pairs
                  </button>
                ))}
                {bench.value?.isRunning && (
                  <button
                    type="button"
                    data-testid="bench-cancel"
                    onClick$={cancelBench}
                    style="padding: 4px 10px; border: 1px solid #dc2626; background: #fff; color: #dc2626; border-radius: 4px; cursor: pointer; font-size: 12px;"
                  >
                    Cancel
                  </button>
                )}
              </div>
              {bench.value?.isRunning && (
                <div data-testid="bench-progress" style="font-size: 12px; color: #555;">
                  {`Running ${bench.value.completed} / ${bench.value.total}…`}
                </div>
              )}
              {bench.value && bench.value.championResults.length > 0 && (
                <div data-testid="bench-results" style="font-size: 12px;">
                  <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <thead style="background: #f8fafc;">
                      <tr>
                        <th style="padding: 4px; text-align: left;">Pipeline</th>
                        <th style="padding: 4px;">N</th>
                        <th style="padding: 4px;">Mean words</th>
                        <th style="padding: 4px;">Mean ms</th>
                        <th style="padding: 4px;">Mean swaps</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[bench.value.championResults, bench.value.challengerResults].map((rows, idx) => {
                        const id = idx === 0 ? bench.value!.championId : bench.value!.challengerId;
                        const meanWords = meanOf(rows);
                        const meanElapsed = rows.length ? rows.reduce((a, r) => a + r.elapsedMs, 0) / rows.length : 0;
                        const meanSwaps = rows.length ? rows.reduce((a, r) => a + r.mutationsApplied, 0) / rows.length : 0;
                        return (
                          <tr key={id} style={`border-top: 1px solid #f1f5f9; ${idx === 0 ? 'background: #ecfeff;' : ''}`}>
                            <td style="padding: 4px;"><code>{id}</code></td>
                            <td style="padding: 4px; text-align: center;">{rows.length}</td>
                            <td style="padding: 4px; text-align: center; font-weight: 600;">
                              {meanWords.toFixed(1)}
                            </td>
                            <td style="padding: 4px; text-align: center;">
                              {meanElapsed.toFixed(0)}
                            </td>
                            <td style="padding: 4px; text-align: center;">
                              {meanSwaps.toFixed(1)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div data-testid="bench-delta" style="margin-top: 8px; font-size: 12px;">
                    {(() => {
                      const a = meanOf(bench.value!.championResults);
                      const b = meanOf(bench.value!.challengerResults);
                      const d = b - a;
                      const sign = d >= 0 ? '+' : '';
                      const color = d > 0 ? '#16a34a' : d < 0 ? '#dc2626' : '#555';
                      return (
                        <span style={`color: ${color};`}>
                          {`Δ player-words: ${sign}${d.toFixed(1)} (challenger ${d > 0 ? 'beats' : d < 0 ? 'loses to' : 'ties'} champion)`}
                        </span>
                      );
                    })()}
                  </div>
                  {/* Per-row board grid for inspection */}
                  <details style="margin-top: 8px;">
                    <summary style="cursor: pointer; font-size: 12px; color: #555;">Per-board details</summary>
                    <div style="margin-top: 6px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-family: ui-monospace, monospace; font-size: 10px;">
                      {[...bench.value.championResults.map((r) => ({ ...r, side: 'C' })), ...bench.value.challengerResults.map((r) => ({ ...r, side: '♣' }))].map((r) => (
                        <div
                          key={r.id}
                          style={`padding: 4px; background: ${r.side === 'C' ? '#ecfeff' : '#fef3c7'}; border-radius: 4px;`}
                        >
                          <div>{`${r.side} ${r.pipelineId} · ${r.playerRelevantWords}w · ${r.elapsedMs.toFixed(0)}ms`}</div>
                          <button
                            type="button"
                            onClick$={() => loadBoardIntoGame(r as BatchRow)}
                            style="margin-top: 2px; background: transparent; border: 0; cursor: pointer; padding: 0; color: #2563eb; font-size: 10px;"
                          >
                            Load · Save{' '}
                          </button>
                          <button
                            type="button"
                            onClick$={() => saveBoard(r as BatchRow)}
                            style="background: transparent; border: 0; cursor: pointer; padding: 0; color: #2563eb; font-size: 10px;"
                          >
                            ☆
                          </button>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}
            </section>
          )}

          {/* Saved tab */}
          {tab.value === 'saved' && (
            <section data-testid="pipeline-lab-saved">
              {(builder.savedBoards as unknown as SavedBoard[]).length === 0 ? (
                <div
                  data-testid="pipeline-lab-saved-empty"
                  style="font-size: 12px; color: #777; padding: 8px; background: #f8fafc; border-radius: 6px;"
                >
                  Save a board from a Bench result to see it here. Saved boards persist across sessions.
                </div>
              ) : (
                <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px;">
                  {(builder.savedBoards as unknown as SavedBoard[]).map((s) => (
                    <li
                      key={s.id}
                      style="border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px; font-size: 12px;"
                    >
                      <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                        <span style="font-weight: 600;">
                          {`${s.playerRelevantWords} words · ${s.finalScore.toFixed(0)} score · ${s.pipelineId}`}
                        </span>
                        <button
                          type="button"
                          onClick$={() => loadBoardIntoGame(s)}
                          style="background: transparent; border: 0; cursor: pointer; font-size: 14px; padding: 0 4px;"
                        >
                          ↩
                        </button>
                      </div>
                      <div style="font-family: ui-monospace, monospace; color: #666; margin-top: 4px;">
                        {s.board.toUpperCase()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </aside>
    </>
  );
});
