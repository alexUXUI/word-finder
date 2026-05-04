import { $, component$, useContext, useSignal } from '@builder.io/qwik';
import {
  AnswersCtx,
  BoardCtx,
  GameCtx,
  SmartCtx,
  WorkerCtx,
} from '../context';
import type { BatchRunRow } from '../context';
import {
  loadRatings,
  persistRating,
  exportRatingsToFile,
} from '../calibration/storage';

/**
 * Multi-run dashboard. Slides in from the right edge as a frosted-glass
 * side panel — same design language as the Controls panel and Found
 * Words panel. Auto-opens when a fresh batch completes; player can
 * close, or pop it back open with the right-edge "📊 Stats" tab.
 *
 * Three visualizations:
 *   1. SVG bar chart — per-run player words (ranked or by run #),
 *      best gold, ≥floor blue, <floor amber, floor as red dashed line
 *   2. SVG scatter plot — cost (ms) × quality (player-words), Pareto
 *      frontier as green polyline
 *   3. Sortable table — every per-run dimension, ↩ load + 👍/👎 rate
 *
 * Pure inline SVG (zero dependencies, sharp at any zoom). Glass styling
 * shared from `src/global.css` (.glass-panel, .glass-card, .glass-table,
 * .glass-chart, etc.) so the dashboard reads as part of the same family
 * as the rest of the UI.
 */

type SortKey =
  | 'idx'
  | 'playerRelevantWords'
  | 'maxWordLength'
  | 'finalScore'
  | 'elapsedMs'
  | 'mutationsApplied'
  | 'candidatesEvaluated'
  | 'modelCalls'
  | 'criticScore'
  | 'averageWordLength'
  | 'vowelRatio'
  | 'letterEntropy'
  | 'prefixDiversity';

interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

export const BatchDashboard = component$(() => {
  const smart = useContext(SmartCtx);
  const game = useContext(GameCtx);
  const board = useContext(BoardCtx);
  const answers = useContext(AnswersCtx);
  const worker = useContext(WorkerCtx);

  const sort = useSignal<SortState>({ key: 'finalScore', dir: 'desc' });
  const orderByRun = useSignal<boolean>(false);
  const ratingsCount = useSignal<number>(
    typeof window !== 'undefined' ? loadRatings().length : 0
  );

  const open = $(() => {
    smart.dashboardOpen = true;
  });
  const close = $(() => {
    smart.dashboardOpen = false;
  });

  const setSort = $((key: SortKey) => {
    if (sort.value.key === key) {
      sort.value = { key, dir: sort.value.dir === 'desc' ? 'asc' : 'desc' };
    } else {
      sort.value = { key, dir: 'desc' };
    }
  });

  const loadIntoGame = $((row: BatchRunRow) => {
    if (!row.board) return;
    board.chars = [...row.board];
    answers.answers = [];
    worker.mod?.postMessage({
      language: game.language,
      board: board.chars,
      minCharLength: game.minCharLength,
      isDictionaryLoaded: true,
    });
  });

  const rateRow = $((row: BatchRunRow, rating: number) => {
    persistRating({
      pipelineId: row.pipelineId,
      board: row.board,
      goalSignature: `size=${board.boardSize};min=${game.minCharLength}`,
      rating,
      capturedAt: new Date().toISOString(),
    });
    ratingsCount.value = loadRatings().length;
  });

  const exportRatings = $(() => exportRatingsToFile());

  const rows = smart.lastBatch ?? [];
  const isOpen = !!smart.dashboardOpen;
  const hasData = rows.length > 0 || smart.batchProgress;

  // ── stats ───────────────────────────────────────────────────────────
  const pwVals = rows.map((r) => r.playerRelevantWords);
  const meanPw = pwVals.length ? pwVals.reduce((a, b) => a + b, 0) / pwVals.length : 0;
  const maxPw = pwVals.length ? Math.max(...pwVals) : 0;
  const minPw = pwVals.length ? Math.min(...pwVals) : 0;
  const totalMs = rows.reduce((s, r) => s + r.elapsedMs, 0);
  const floorMetCount = rows.filter((r) => r.floorMet).length;
  const bestIdx = rows.length
    ? rows.reduce((bi, r, i) =>
        (r.criticScore ?? r.finalScore) >
        (rows[bi].criticScore ?? rows[bi].finalScore)
          ? i
          : bi
      , 0)
    : -1;

  // ── sort rows for table ─────────────────────────────────────────────
  const sortedRows = [...rows].sort((a, b) => {
    const k = sort.value.key;
    const av = (a[k] ?? 0) as number;
    const bv = (b[k] ?? 0) as number;
    return sort.value.dir === 'asc' ? av - bv : bv - av;
  });

  // ── bar chart ───────────────────────────────────────────────────────
  const barRows = orderByRun.value
    ? rows
    : [...rows].sort((a, b) => b.playerRelevantWords - a.playerRelevantWords);
  const W = 480;
  const H = 200;
  const PAD_L = 36;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 26;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const yMax = Math.max(maxPw, game.minWordsPerBoard, 1) * 1.1;
  const barW = innerW / Math.max(barRows.length, 1);
  const yToPx = (v: number): number => PAD_T + innerH - (v / yMax) * innerH;
  const floorY = yToPx(game.minWordsPerBoard);

  // ── scatter ─────────────────────────────────────────────────────────
  const SW = 480;
  const SH = 180;
  const SPAD_L = 44;
  const SPAD_R = 12;
  const SPAD_T = 12;
  const SPAD_B = 26;
  const sInnerW = SW - SPAD_L - SPAD_R;
  const sInnerH = SH - SPAD_T - SPAD_B;
  const msMax = rows.length ? Math.max(...rows.map((r) => r.elapsedMs)) * 1.05 : 1000;
  const msMin = rows.length ? Math.min(...rows.map((r) => r.elapsedMs)) * 0.95 : 0;
  const wMax = Math.max(yMax, 1);
  const xToPx = (ms: number): number =>
    SPAD_L + ((ms - msMin) / Math.max(msMax - msMin, 1)) * sInnerW;
  const yToPx2 = (w: number): number => SPAD_T + sInnerH - (w / wMax) * sInnerH;

  // Pareto frontier inline (Qwik can't capture root-level helpers in $())
  const frontierIdx = (() => {
    const frontier = new Set<number>();
    for (let i = 0; i < rows.length; i++) {
      const a = rows[i];
      let dominated = false;
      for (let j = 0; j < rows.length; j++) {
        if (i === j) continue;
        const b = rows[j];
        if (
          b.elapsedMs <= a.elapsedMs &&
          b.playerRelevantWords >= a.playerRelevantWords &&
          (b.elapsedMs < a.elapsedMs ||
            b.playerRelevantWords > a.playerRelevantWords)
        ) {
          dominated = true;
          break;
        }
      }
      if (!dominated) frontier.add(i);
    }
    return frontier;
  })();

  return (
    <>
      {/* Right-edge tab — visible whenever there's data, even when panel closed */}
      {hasData && !isOpen && (
        <button
          type="button"
          data-testid="batch-dashboard-toggle"
          onClick$={open}
          class="glass-tab"
          style="top: 36%;"
          aria-label="Open batch dashboard"
        >
          📊 Stats
        </button>
      )}

      {/* Slide-in panel */}
      <aside
        data-testid="batch-dashboard"
        data-runs={rows.length}
        data-open={isOpen ? 'true' : 'false'}
        class="glass-panel"
        style={`position: fixed; top: 0; right: 0; bottom: 0; width: min(540px, 95vw); z-index: 110; overflow-y: auto; transform: translateX(${isOpen ? '0' : '100%'}); transition: transform 0.22s ease-out;`}
      >
        <div style="padding: 14px 14px 24px; display: flex; flex-direction: column; gap: 12px;">
          {/* Header */}
          <header style="display: flex; align-items: center; justify-content: space-between;">
            <h2 style="margin: 0; font-size: 16px; font-weight: 600; color: #1e3a8a; letter-spacing: 0.01em;">
              📊 Batch Dashboard
            </h2>
            <button
              type="button"
              data-testid="batch-dashboard-close"
              onClick$={close}
              class="glass-btn-icon"
              aria-label="Close panel"
              style="font-size: 18px;"
            >
              ×
            </button>
          </header>

          {/* Stats strip */}
          {rows.length > 0 && (
            <div
              data-testid="batch-dashboard-header"
              class="glass-card"
              style="padding: 8px 12px; display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: #1e3a8a;"
            >
              <span data-testid="batch-stat-best">
                <strong>best</strong> {maxPw}
              </span>
              <span data-testid="batch-stat-mean">
                <strong>mean</strong> {meanPw.toFixed(1)}
              </span>
              <span data-testid="batch-stat-min">
                <strong>min</strong> {minPw}
              </span>
              <span data-testid="batch-stat-floor-met">
                <strong>floor</strong> {floorMetCount}/{rows.length} met
              </span>
              <span data-testid="batch-stat-time">
                <strong>total</strong> {(totalMs / 1000).toFixed(1)}s
              </span>
              <span style="margin-left: auto; display: flex; align-items: center; gap: 8px;">
                <span data-testid="calibration-ratings-count" style="color: #475569;">
                  {ratingsCount.value} ratings
                </span>
                {ratingsCount.value > 0 && (
                  <button
                    type="button"
                    data-testid="calibration-export"
                    onClick$={exportRatings}
                    class="glass-btn"
                    style="font-size: 11px; padding: 2px 8px;"
                    title="Download ratings JSON for the bench calibration step"
                  >
                    ⬇ export
                  </button>
                )}
              </span>
            </div>
          )}

          {/* Live progress */}
          {smart.batchProgress &&
            smart.batchProgress.completed < smart.batchProgress.total && (
              <div class="glass-banner">
                <strong>Running</strong> {smart.batchProgress.completed}/
                {smart.batchProgress.total} · best so far{' '}
                <strong>{smart.batchProgress.bestSoFar}</strong> player words
              </div>
            )}

          {/* Bar chart card */}
          <section class="glass-card" style="padding: 10px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
              <span style="font-size: 12px; font-weight: 600; color: #1e3a8a;">
                Player words per run
              </span>
              <button
                type="button"
                data-testid="batch-chart-order-toggle"
                onClick$={() => (orderByRun.value = !orderByRun.value)}
                class="glass-btn"
                style="font-size: 11px; padding: 2px 8px; margin-left: auto;"
              >
                {orderByRun.value ? 'show ranked' : 'show by run #'}
              </button>
            </div>
            <svg
              data-testid="batch-chart-bars"
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label="Player-relevant words per run, bar chart"
              class="glass-chart"
              style="width: 100%; height: auto;"
            >
              {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                const v = Math.round(yMax * t);
                const y = yToPx(v);
                return (
                  <g key={`y-${t}`}>
                    <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="rgba(30,58,138,0.06)" />
                    <text
                      x={PAD_L - 6}
                      y={y + 4}
                      font-size={10}
                      fill="#64748b"
                      text-anchor="end"
                    >
                      {v}
                    </text>
                  </g>
                );
              })}
              {game.minWordsPerBoard > 0 && (
                <g>
                  <line
                    x1={PAD_L}
                    y1={floorY}
                    x2={W - PAD_R}
                    y2={floorY}
                    stroke="#dc2626"
                    stroke-width={1.2}
                    stroke-dasharray="4 3"
                  />
                  <text
                    x={W - PAD_R - 4}
                    y={floorY - 4}
                    font-size={10}
                    fill="#dc2626"
                    text-anchor="end"
                  >
                    floor {game.minWordsPerBoard}
                  </text>
                </g>
              )}
              {barRows.map((r, i) => {
                const x = PAD_L + i * barW + barW * 0.1;
                const y = yToPx(r.playerRelevantWords);
                const h = PAD_T + innerH - y;
                const isBest = r.idx === bestIdx;
                const fill = isBest
                  ? '#f59e0b'
                  : r.playerRelevantWords >= game.minWordsPerBoard
                    ? '#3b82f6'
                    : '#94a3b8';
                return (
                  <g key={`bar-${r.idx}`}>
                    <rect
                      data-testid="batch-chart-bar"
                      data-run-idx={r.idx}
                      x={x}
                      y={y}
                      width={barW * 0.8}
                      height={Math.max(0, h)}
                      fill={fill}
                      rx={2}
                    />
                    {barRows.length <= 25 && (
                      <text
                        x={x + barW * 0.4}
                        y={y - 4}
                        font-size={9}
                        fill={isBest ? '#92400e' : '#475569'}
                        text-anchor="middle"
                        font-weight={isBest ? 700 : 400}
                      >
                        {r.playerRelevantWords}
                      </text>
                    )}
                  </g>
                );
              })}
              <text
                x={W / 2}
                y={H - 4}
                font-size={10}
                fill="#64748b"
                text-anchor="middle"
              >
                {orderByRun.value ? 'run #' : 'rank (best → worst)'}
              </text>
            </svg>
          </section>

          {/* Scatter card */}
          <section class="glass-card" style="padding: 10px;">
            <div style="font-size: 12px; font-weight: 600; color: #1e3a8a; margin-bottom: 4px;">
              Quality vs cost <span style="color:#16a34a;">(Pareto frontier)</span>
            </div>
            <svg
              data-testid="batch-chart-scatter"
              viewBox={`0 0 ${SW} ${SH}`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label="Quality (player words) vs cost (elapsed ms), scatter"
              class="glass-chart"
              style="width: 100%; height: auto;"
            >
              <line x1={SPAD_L} y1={SPAD_T} x2={SPAD_L} y2={SH - SPAD_B} stroke="rgba(30,58,138,0.15)" />
              <line x1={SPAD_L} y1={SH - SPAD_B} x2={SW - SPAD_R} y2={SH - SPAD_B} stroke="rgba(30,58,138,0.15)" />
              <text x={SPAD_L / 2} y={SH / 2} font-size={10} fill="#64748b" transform={`rotate(-90 ${SPAD_L / 2} ${SH / 2})`} text-anchor="middle">
                player words
              </text>
              <text x={SW / 2} y={SH - 4} font-size={10} fill="#64748b" text-anchor="middle">
                elapsed ms
              </text>
              {(() => {
                const frontier = rows
                  .map((r, i) => ({ r, i }))
                  .filter((x) => frontierIdx.has(x.i))
                  .sort((a, b) => a.r.elapsedMs - b.r.elapsedMs);
                if (frontier.length < 2) return null;
                const pts = frontier
                  .map(({ r }) => `${xToPx(r.elapsedMs)},${yToPx2(r.playerRelevantWords)}`)
                  .join(' ');
                return <polyline points={pts} fill="none" stroke="#16a34a" stroke-width={1.5} />;
              })()}
              {rows.map((r, i) => {
                const isFrontier = frontierIdx.has(i);
                const isBest = i === bestIdx;
                return (
                  <circle
                    key={`pt-${r.idx}`}
                    data-testid="batch-chart-point"
                    data-run-idx={r.idx}
                    cx={xToPx(r.elapsedMs)}
                    cy={yToPx2(r.playerRelevantWords)}
                    r={isBest ? 6 : 4}
                    fill={isBest ? '#f59e0b' : isFrontier ? '#16a34a' : '#3b82f6'}
                    stroke={isBest ? '#92400e' : 'white'}
                    stroke-width={1.5}
                  />
                );
              })}
            </svg>
          </section>

          {/* Table card */}
          {rows.length > 0 && (
            <section class="glass-card" style="padding: 10px; overflow-x: auto;">
              <div style="font-size: 12px; font-weight: 600; color: #1e3a8a; margin-bottom: 4px;">
                Per-run details
              </div>
              <table data-testid="batch-table" class="glass-table">
                <thead>
                  <tr>
                    {([
                      ['idx', '#'],
                      ['playerRelevantWords', 'Words'],
                      ['maxWordLength', 'Max'],
                      ['averageWordLength', 'Avg'],
                      ['finalScore', 'Score'],
                      ['criticScore', 'Critic'],
                      ['mutationsApplied', 'Mut'],
                      ['candidatesEvaluated', 'Cands'],
                      ['modelCalls', 'Calls'],
                      ['elapsedMs', 'ms'],
                      ['vowelRatio', 'Vow'],
                      ['letterEntropy', 'Ent'],
                      ['prefixDiversity', 'Pref'],
                    ] as [SortKey, string][]).map(([k, label]) => (
                      <th
                        key={k}
                        data-testid={`batch-table-header-${k}`}
                        onClick$={() => setSort(k)}
                      >
                        {label}
                        {sort.value.key === k ? (sort.value.dir === 'desc' ? ' ▼' : ' ▲') : ''}
                      </th>
                    ))}
                    <th style="text-align: center;">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => {
                    const isBest = r.idx === bestIdx;
                    return (
                      <tr
                        key={r.idx}
                        data-testid="batch-table-row"
                        data-run-idx={r.idx}
                        data-is-best={isBest ? 'true' : 'false'}
                      >
                        <td>{r.idx + 1}</td>
                        <td style="font-weight: 600;">{r.playerRelevantWords}</td>
                        <td>{r.maxWordLength}</td>
                        <td>{r.averageWordLength.toFixed(1)}</td>
                        <td>{r.finalScore.toFixed(0)}</td>
                        <td>{r.criticScore !== undefined ? r.criticScore.toFixed(2) : '—'}</td>
                        <td>{r.mutationsApplied}</td>
                        <td>{r.candidatesEvaluated}</td>
                        <td>{r.modelCalls}</td>
                        <td>{r.elapsedMs.toFixed(0)}</td>
                        <td>{r.vowelRatio.toFixed(2)}</td>
                        <td>{r.letterEntropy.toFixed(2)}</td>
                        <td>{r.prefixDiversity}</td>
                        <td style="text-align: center; white-space: nowrap;">
                          <button
                            type="button"
                            data-testid="batch-table-load"
                            onClick$={() => loadIntoGame(r)}
                            class="glass-btn-icon"
                            title="Load this board into the game"
                          >
                            ↩
                          </button>
                          <button
                            type="button"
                            data-testid="batch-table-thumb-up"
                            onClick$={() => rateRow(r, 1)}
                            class="glass-btn-icon"
                            title="Rate this board good (calibrates the SLM judge)"
                          >
                            👍
                          </button>
                          <button
                            type="button"
                            data-testid="batch-table-thumb-down"
                            onClick$={() => rateRow(r, 0)}
                            class="glass-btn-icon"
                            title="Rate this board poor"
                          >
                            👎
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}
        </div>
      </aside>
    </>
  );
});
