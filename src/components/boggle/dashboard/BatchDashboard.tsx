import { $, component$, useContext, useSignal } from '@builder.io/qwik';
import {
  AnswersCtx,
  BoardCtx,
  GameCtx,
  SmartCtx,
  WorkerCtx,
} from '../context';
import type { BatchRunRow } from '../context';

/**
 * Multi-run dashboard. Renders inline below the Smart Banner once a batch
 * has completed (or while it's running, with partial data).
 *
 * Three visualizations:
 *   1. Header summary — n, mean / max words, total wall ms, floor-met count
 *   2. SVG bar chart — per-run player words (ranked or by run order),
 *      best run gold-highlighted, floor as red dashed line
 *   3. SVG scatter — cost (ms) vs quality (player words). Pareto frontier
 *      highlighted with a polyline connecting frontier points.
 *   4. Sortable table — every dimension we capture per run, with
 *      Load (apply that board to the live game) and 👍/👎 actions.
 *
 * Pure inline SVG — no chart library dependency. Sharp at any zoom,
 * accessible, ~3 KB unminified.
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

  // The dashboard only renders when there's batch data. The chart can
  // appear mid-run (partial data) so we don't gate on completion.
  const rows = smart.lastBatch ?? [];
  if (rows.length === 0 && !smart.batchProgress) {
    return null;
  }

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
    if (typeof window === 'undefined') return;
    const ratingsKey = 'word-finder.calibration.ratings';
    try {
      const existing = JSON.parse(
        window.localStorage.getItem(ratingsKey) ?? '[]'
      ) as unknown[];
      const arr = Array.isArray(existing) ? existing : [];
      arr.push({
        pipelineId: row.pipelineId,
        board: row.board,
        goalSignature: `size=${board.boardSize};min=${game.minCharLength}`,
        rating,
        capturedAt: new Date().toISOString(),
      });
      window.localStorage.setItem(ratingsKey, JSON.stringify(arr));
    } catch {
      /* ignore */
    }
  });

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
  // X axis: run index (0..n) OR rank order (best→worst) based on toggle.
  // Y axis: playerRelevantWords. Floor line at goal.minWordsPerBoard.
  const barRows = orderByRun.value
    ? rows
    : [...rows].sort((a, b) => b.playerRelevantWords - a.playerRelevantWords);
  const W = 720;
  const H = 220;
  const PAD_L = 40;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const yMax = Math.max(maxPw, game.minWordsPerBoard, 1) * 1.1;
  const barW = innerW / Math.max(barRows.length, 1);
  const yToPx = (v: number): number => PAD_T + innerH - (v / yMax) * innerH;
  const floorY = yToPx(game.minWordsPerBoard);

  // ── scatter ─────────────────────────────────────────────────────────
  const SW = 720;
  const SH = 200;
  const SPAD_L = 50;
  const SPAD_R = 12;
  const SPAD_T = 12;
  const SPAD_B = 28;
  const sInnerW = SW - SPAD_L - SPAD_R;
  const sInnerH = SH - SPAD_T - SPAD_B;
  const msMax = rows.length ? Math.max(...rows.map((r) => r.elapsedMs)) * 1.05 : 1000;
  const msMin = rows.length ? Math.min(...rows.map((r) => r.elapsedMs)) * 0.95 : 0;
  const wMax = Math.max(yMax, 1);
  const xToPx = (ms: number): number =>
    SPAD_L + ((ms - msMin) / Math.max(msMax - msMin, 1)) * sInnerW;
  const yToPx2 = (w: number): number => SPAD_T + sInnerH - (w / wMax) * sInnerH;
  // Pareto frontier on (elapsedMs, playerRelevantWords). Inline because
  // Qwik's optimizer can't serialize root-level helpers used inside the
  // component's render closure.
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
    <section
      data-testid="batch-dashboard"
      data-runs={rows.length}
      style="margin: 12px auto; padding: 12px; max-width: 760px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px;"
    >
      {/* Header */}
      <header
        data-testid="batch-dashboard-header"
        style="display: flex; align-items: baseline; flex-wrap: wrap; gap: 12px; margin-bottom: 8px;"
      >
        <h2 style="margin: 0; font-size: 15px; font-weight: 600; color: #1e3a8a;">
          📊 Last batch
          {smart.batchProgress &&
          smart.batchProgress.completed < smart.batchProgress.total
            ? ` (running ${smart.batchProgress.completed}/${smart.batchProgress.total}…)`
            : ` · ${rows.length} runs`}
        </h2>
        {rows.length > 0 && (
          <div style="font-size: 12px; color: #475569; display: flex; gap: 12px; flex-wrap: wrap;">
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
          </div>
        )}
      </header>

      {/* Bar chart */}
      <div style="display: flex; align-items: center; gap: 8px; margin: 4px 0;">
        <span style="font-size: 11px; font-weight: 600; color: #475569;">Player words per run</span>
        <button
          type="button"
          data-testid="batch-chart-order-toggle"
          onClick$={() => (orderByRun.value = !orderByRun.value)}
          style="font-size: 11px; padding: 2px 8px; border: 1px solid #cbd5e1; background: white; cursor: pointer; border-radius: 4px;"
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
        style="width: 100%; height: auto; background: white; border: 1px solid #e2e8f0; border-radius: 6px;"
      >
        {/* Y-axis ticks */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const v = Math.round(yMax * t);
          const y = yToPx(v);
          return (
            <g key={`y-${t}`}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#f1f5f9" />
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
        {/* Floor line */}
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
        {/* Bars */}
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
                  font-size={10}
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
        {/* X axis label */}
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

      {/* Scatter */}
      <div style="font-size: 11px; font-weight: 600; color: #475569; margin: 8px 0 4px;">
        Quality vs cost (Pareto frontier in green)
      </div>
      <svg
        data-testid="batch-chart-scatter"
        viewBox={`0 0 ${SW} ${SH}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Quality (player words) vs cost (elapsed ms), scatter"
        style="width: 100%; height: auto; background: white; border: 1px solid #e2e8f0; border-radius: 6px;"
      >
        {/* Axes */}
        <line
          x1={SPAD_L}
          y1={SPAD_T}
          x2={SPAD_L}
          y2={SH - SPAD_B}
          stroke="#cbd5e1"
        />
        <line
          x1={SPAD_L}
          y1={SH - SPAD_B}
          x2={SW - SPAD_R}
          y2={SH - SPAD_B}
          stroke="#cbd5e1"
        />
        <text x={SPAD_L / 2} y={SH / 2} font-size={10} fill="#64748b" transform={`rotate(-90 ${SPAD_L / 2} ${SH / 2})`} text-anchor="middle">
          player words
        </text>
        <text x={SW / 2} y={SH - 4} font-size={10} fill="#64748b" text-anchor="middle">
          elapsed ms
        </text>
        {/* Pareto polyline (frontier sorted by elapsed asc) */}
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
        {/* Points */}
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

      {/* Table */}
      {rows.length > 0 && (
        <div style="margin-top: 12px; overflow-x: auto;">
          <table
            data-testid="batch-table"
            style="width: 100%; border-collapse: collapse; font-size: 11px;"
          >
            <thead style="background: #e2e8f0;">
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
                    style="padding: 4px 6px; text-align: right; cursor: pointer; user-select: none; white-space: nowrap;"
                  >
                    {label}
                    {sort.value.key === k ? (sort.value.dir === 'desc' ? ' ▼' : ' ▲') : ''}
                  </th>
                ))}
                <th style="padding: 4px 6px; text-align: center;">Actions</th>
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
                    style={`border-top: 1px solid #f1f5f9; ${isBest ? 'background: #fef3c7;' : ''}`}
                  >
                    <td style="padding: 4px 6px; text-align: right; font-weight: 600;">
                      {r.idx + 1}
                    </td>
                    <td style="padding: 4px 6px; text-align: right; font-weight: 600;">
                      {r.playerRelevantWords}
                    </td>
                    <td style="padding: 4px 6px; text-align: right;">{r.maxWordLength}</td>
                    <td style="padding: 4px 6px; text-align: right;">
                      {r.averageWordLength.toFixed(1)}
                    </td>
                    <td style="padding: 4px 6px; text-align: right;">
                      {r.finalScore.toFixed(0)}
                    </td>
                    <td style="padding: 4px 6px; text-align: right;">
                      {r.criticScore !== undefined ? r.criticScore.toFixed(2) : '—'}
                    </td>
                    <td style="padding: 4px 6px; text-align: right;">{r.mutationsApplied}</td>
                    <td style="padding: 4px 6px; text-align: right;">
                      {r.candidatesEvaluated}
                    </td>
                    <td style="padding: 4px 6px; text-align: right;">{r.modelCalls}</td>
                    <td style="padding: 4px 6px; text-align: right;">
                      {r.elapsedMs.toFixed(0)}
                    </td>
                    <td style="padding: 4px 6px; text-align: right;">
                      {r.vowelRatio.toFixed(2)}
                    </td>
                    <td style="padding: 4px 6px; text-align: right;">
                      {r.letterEntropy.toFixed(2)}
                    </td>
                    <td style="padding: 4px 6px; text-align: right;">{r.prefixDiversity}</td>
                    <td style="padding: 4px 6px; text-align: center; white-space: nowrap;">
                      <button
                        type="button"
                        data-testid="batch-table-load"
                        onClick$={() => loadIntoGame(r)}
                        title="Load this board into the game"
                        style="background: transparent; border: 0; cursor: pointer; font-size: 14px; padding: 0 3px;"
                      >
                        ↩
                      </button>
                      <button
                        type="button"
                        data-testid="batch-table-thumb-up"
                        onClick$={() => rateRow(r, 1)}
                        title="Rate this board good (calibrates the SLM judge)"
                        style="background: transparent; border: 0; cursor: pointer; font-size: 14px; padding: 0 3px;"
                      >
                        👍
                      </button>
                      <button
                        type="button"
                        data-testid="batch-table-thumb-down"
                        onClick$={() => rateRow(r, 0)}
                        title="Rate this board poor"
                        style="background: transparent; border: 0; cursor: pointer; font-size: 14px; padding: 0 3px;"
                      >
                        👎
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
});
