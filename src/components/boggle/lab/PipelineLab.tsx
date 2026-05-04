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
          class="glass-tab"
          style="top: 56%;"
        >
          🧪 Pipeline Lab
        </button>
      )}

      <aside
        data-testid="pipeline-lab-panel"
        data-open={builder.open ? 'true' : 'false'}
        class="glass-panel"
        style={`position: fixed; top: 0; right: 0; bottom: 0; width: min(560px, 95vw); z-index: 110; overflow-y: auto; transform: translateX(${builder.open ? '0' : '100%'}); transition: transform 0.22s ease-out;`}
      >
        <div style="padding: 14px 14px 24px; display: flex; flex-direction: column; gap: 12px; font-size: 13px;">
          <header style="display: flex; align-items: center; justify-content: space-between;">
            <h2 style="margin: 0; font-size: 16px; font-weight: 600; color: #1e3a8a; letter-spacing: 0.01em;">
              🧪 Pipeline Lab
            </h2>
            <button
              type="button"
              data-testid="pipeline-lab-close"
              onClick$={close}
              class="glass-btn-icon"
              aria-label="Close panel"
              style="font-size: 18px;"
            >
              ×
            </button>
          </header>

          {/* Champion banner */}
          <div
            data-testid="pipeline-lab-champion"
            data-champion-id={championId.value ?? ''}
            class="glass-banner"
          >
            <strong>Champion:</strong>{' '}
            <code data-testid="pipeline-lab-champion-id" style="font-family: ui-monospace, monospace;">
              {championId.value ?? '(none)'}
            </code>{' '}
            — what Smart Mode runs in the player UI.
          </div>

          {/* Tabs */}
          <nav role="tablist" style="display: flex; gap: 4px; border-bottom: 1px solid rgba(30,58,138,0.15);">
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
                style={`padding: 8px 14px; border: 0; cursor: pointer; background: ${tab.value === t.id ? 'rgba(255,255,255,0.85)' : 'transparent'}; font-weight: ${tab.value === t.id ? '600' : '400'}; color: ${tab.value === t.id ? '#1e3a8a' : '#475569'}; border-bottom: 2px solid ${tab.value === t.id ? '#2563eb' : 'transparent'}; font-size: 13px; border-radius: 6px 6px 0 0; transition: background 0.12s;`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {/* Prompt */}
          <section class="glass-card" style="padding: 10px;">
            <label style="display: block; font-weight: 600; margin-bottom: 4px; font-size: 12px; color: #1e3a8a;">
              Goal description (threads into pipeline runs)
            </label>
            <textarea
              data-testid="pipeline-lab-prompt"
              rows={2}
              value={prompt.value}
              onInput$={(_, el) => updatePrompt(el.value)}
              placeholder="e.g. 'long words ending in -ing', 'rare letters', 'chaotic mix'"
              style="width: 100%; padding: 8px; border: 2px solid rgba(30,58,138,0.4); border-radius: 6px; font-size: 12px; resize: vertical; background: rgba(255,255,255,0.7); font-family: inherit;"
            />
          </section>

          {smart.modelStatus !== 'ready' && (
            <div data-testid="pipeline-lab-no-model" class="glass-banner-warn">
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
                      class={isChamp ? 'glass-card-accent' : 'glass-card'}
                      style="padding: 10px;"
                    >
                      <header style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                          <code style="font-weight: 600; font-size: 13px; background: rgba(30,58,138,0.08); padding: 2px 8px; border-radius: 6px; color: #1e3a8a;">{p.id}</code>
                          <span style="color: #64748b; font-size: 11px;">
                            {`v${p.version}`}
                          </span>
                          {isChamp ? (
                            <span class="glass-pill">champion</span>
                          ) : null}
                        </div>
                        <span style="display: inline-flex; gap: 4px;">
                          <button
                            type="button"
                            data-testid="pipeline-card-run"
                            disabled={smart.modelStatus !== 'ready'}
                            onClick$={async () => {
                              const rows = await runPipelineN(p.id, 5);
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
                            class="glass-btn"
                          >
                            Run 5×
                          </button>
                          {!isChamp && (
                            <button
                              type="button"
                              data-testid="pipeline-card-promote"
                              onClick$={() => promote(p.id)}
                              class="glass-btn-promote"
                            >
                              Promote
                            </button>
                          )}
                        </span>
                      </header>
                      <p style="margin: 6px 0 0 0; font-size: 12px; color: #334155; line-height: 1.4;">
                        {p.description}
                      </p>
                      {card ? (
                        <div
                          data-testid="pipeline-card-scores"
                          style="margin-top: 8px; font-size: 11px; color: #1e3a8a; font-family: ui-monospace, monospace; background: rgba(255,255,255,0.4); padding: 4px 8px; border-radius: 4px;"
                        >
                          {Object.entries(card.perGoal).map(([g, s]) => (
                            <div key={g}>
                              {`${g}: mean=${s.mean}  p10=${s.p10}  p90=${s.p90}  runs=${s.runs}  ms=${s.elapsedMs}`}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style="margin-top: 8px; font-size: 11px; color: #94a3b8; font-style: italic;">
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
              <div class="glass-card" style="padding: 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                <label style="font-size: 12px; font-weight: 600; color: #1e3a8a;">Champion</label>
                <select
                  data-testid="bench-champion-select"
                  value={championId.value ?? ''}
                  onChange$={(_, el) => {
                    championId.value = el.value;
                    persistChampion(el.value);
                  }}
                  style="font-size: 12px; padding: 6px 8px; border: 2px solid rgba(30,58,138,0.4); border-radius: 6px; background: rgba(255,255,255,0.7);"
                >
                  {pipelines.value.map((p) => (
                    <option key={p.id} value={p.id}>{p.id}</option>
                  ))}
                </select>
                <label style="font-size: 12px; color: #64748b;">vs.</label>
                <select
                  data-testid="bench-challenger-select"
                  value={challengerId.value}
                  onChange$={(_, el) => {
                    challengerId.value = el.value;
                  }}
                  style="font-size: 12px; padding: 6px 8px; border: 2px solid rgba(30,58,138,0.4); border-radius: 6px; background: rgba(255,255,255,0.7);"
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
                    class="glass-btn"
                  >
                    Run {n}×
                  </button>
                ))}
                {bench.value?.isRunning && (
                  <button
                    type="button"
                    data-testid="bench-cancel"
                    onClick$={cancelBench}
                    class="glass-btn"
                    style="border-color: #dc2626; color: #dc2626;"
                  >
                    Cancel
                  </button>
                )}
              </div>
              {bench.value?.isRunning && (
                <div data-testid="bench-progress" class="glass-banner">
                  {`Running ${bench.value.completed} / ${bench.value.total}…`}
                </div>
              )}
              {bench.value && bench.value.championResults.length > 0 && (
                <div data-testid="bench-results" class="glass-card" style="padding: 10px; font-size: 12px;">
                  <table class="glass-table">
                    <thead>
                      <tr>
                        <th style="text-align: left;">Pipeline</th>
                        <th>N</th>
                        <th>Words</th>
                        <th>ms</th>
                        <th>Swaps</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[bench.value.championResults, bench.value.challengerResults].map((rows, idx) => {
                        const id = idx === 0 ? bench.value!.championId : bench.value!.challengerId;
                        const meanWords = meanOf(rows);
                        const meanElapsed = rows.length ? rows.reduce((a, r) => a + r.elapsedMs, 0) / rows.length : 0;
                        const meanSwaps = rows.length ? rows.reduce((a, r) => a + r.mutationsApplied, 0) / rows.length : 0;
                        return (
                          <tr key={id} data-is-best={idx === 0 ? 'true' : 'false'}>
                            <td style="text-align: left;"><code style="background: rgba(30,58,138,0.08); padding: 1px 6px; border-radius: 4px;">{id}</code></td>
                            <td>{rows.length}</td>
                            <td style="font-weight: 600;">{meanWords.toFixed(1)}</td>
                            <td>{meanElapsed.toFixed(0)}</td>
                            <td>{meanSwaps.toFixed(1)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div data-testid="bench-delta" style="margin-top: 10px; font-size: 12px; padding: 6px 10px; border-radius: 6px; background: rgba(255,255,255,0.5);">
                    {(() => {
                      const a = meanOf(bench.value!.championResults);
                      const b = meanOf(bench.value!.challengerResults);
                      const d = b - a;
                      const sign = d >= 0 ? '+' : '';
                      const color = d > 0 ? '#16a34a' : d < 0 ? '#dc2626' : '#475569';
                      return (
                        <span style={`color: ${color}; font-weight: 600;`}>
                          {`Δ words: ${sign}${d.toFixed(1)} — challenger ${d > 0 ? 'beats' : d < 0 ? 'loses to' : 'ties'} champion`}
                        </span>
                      );
                    })()}
                  </div>
                  <details style="margin-top: 10px;">
                    <summary style="cursor: pointer; font-size: 12px; color: #1e3a8a; font-weight: 600;">Per-board details</summary>
                    <div style="margin-top: 8px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-family: ui-monospace, monospace; font-size: 10px;">
                      {[...bench.value.championResults.map((r) => ({ ...r, side: 'C' })), ...bench.value.challengerResults.map((r) => ({ ...r, side: '♣' }))].map((r) => (
                        <div
                          key={r.id}
                          class="glass-card"
                          style={`padding: 6px; ${r.side === 'C' ? 'border-color: rgba(8,145,178,0.4);' : 'border-color: rgba(245,158,11,0.4);'}`}
                        >
                          <div style="color: #1e3a8a;">{`${r.side} ${r.pipelineId} · ${r.playerRelevantWords}w · ${r.elapsedMs.toFixed(0)}ms`}</div>
                          <div style="margin-top: 4px; display: flex; gap: 4px;">
                            <button
                              type="button"
                              onClick$={() => loadBoardIntoGame(r as BatchRow)}
                              class="glass-btn-icon"
                              title="Load this board into the game"
                            >
                              ↩
                            </button>
                            <button
                              type="button"
                              onClick$={() => saveBoard(r as BatchRow)}
                              class="glass-btn-icon"
                              title="Save board"
                            >
                              ☆
                            </button>
                          </div>
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
                  class="glass-card"
                  style="font-size: 12px; color: #475569; padding: 14px; text-align: center; font-style: italic;"
                >
                  Save a board from a Bench result to see it here. Saved boards persist across sessions.
                </div>
              ) : (
                <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px;">
                  {(builder.savedBoards as unknown as SavedBoard[]).map((s) => (
                    <li
                      key={s.id}
                      class="glass-card"
                      style="padding: 10px; font-size: 12px;"
                    >
                      <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                        <span style="font-weight: 600; color: #1e3a8a;">
                          {`${s.playerRelevantWords} words · ${s.finalScore.toFixed(0)} score · ${s.pipelineId}`}
                        </span>
                        <button
                          type="button"
                          onClick$={() => loadBoardIntoGame(s)}
                          class="glass-btn-icon"
                          title="Load into game"
                        >
                          ↩
                        </button>
                      </div>
                      <div style="font-family: ui-monospace, monospace; color: #475569; margin-top: 6px; letter-spacing: 0.05em;">
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
