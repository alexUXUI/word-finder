import { $, component$, useContext, useSignal, useTask$ } from '@builder.io/qwik';
import {
  AnswersCtx,
  BoardCtx,
  GameCtx,
  ProfileCtx,
  SmartCtx,
  WorkerCtx,
} from '../context';
import type { BatchRunRow } from '../context';
import {
  loadRatings,
  persistRating,
  exportRatingsToFile,
} from '../calibration/storage';
import { addFavoriteBoard } from '../profile/api';
import { IconClose, IconStar } from '../../shell/icons';

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
  const profile = useContext(ProfileCtx);

  const sort = useSignal<SortState>({ key: 'finalScore', dir: 'desc' });
  const orderByRun = useSignal<boolean>(false);
  const ratingsCount = useSignal<number>(
    typeof window !== 'undefined' ? loadRatings().length : 0
  );

  const close = $(() => {
    smart.dashboardOpen = false;
  });

  // ─── Cross-chart linking ────────────────────────────────────────────
  // hoveredRunIdx is transient; selectedRunIdx persists until reclicked
  // or ESC. Both are stored on SmartCtx so the bar / scatter / table all
  // read from the same source.
  const setHover = $((idx: number | null) => { smart.hoveredRunIdx = idx; });
  const toggleSelect = $((idx: number) => {
    smart.selectedRunIdx = smart.selectedRunIdx === idx ? null : idx;
  });

  // ESC clears selection while panel is open.
  useTask$(({ track, cleanup }) => {
    const isPanelOpen = track(() => smart.dashboardOpen);
    if (!isPanelOpen || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        smart.selectedRunIdx = null;
        smart.hoveredRunIdx = null;
      }
    };
    window.addEventListener('keydown', onKey);
    cleanup(() => window.removeEventListener('keydown', onKey));
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

  const rateRow = $(async (row: BatchRunRow, rating: number) => {
    persistRating({
      pipelineId: row.pipelineId,
      board: row.board,
      goalSignature: `size=${board.boardSize};min=${game.minCharLength}`,
      rating,
      capturedAt: new Date().toISOString(),
    });
    ratingsCount.value = loadRatings().length;
    // 👍 also persists the board to the player's favorites — the calibration
    // signal is for the SLM critic, but the user-facing intent of liking a
    // board is "save it". Idempotent on (board, source).
    if (rating === 1 && profile.playerId) {
      profile.pendingMutation = true;
      try {
        const res = await addFavoriteBoard(profile.playerId, {
          board: row.board,
          size: board.boardSize,
          score: row.playerRelevantWords,
          pipelineId: row.pipelineId,
          source: 'batch',
        });
        if (profile.profile && !res.alreadyExists) {
          profile.profile.favoriteBoards = [res.board, ...profile.profile.favoriteBoards];
        }
      } catch (e) {
        console.error('addFavoriteBoard failed', e);
      } finally {
        profile.pendingMutation = false;
      }
    }
  });

  const exportRatings = $(() => exportRatingsToFile());

  const rows = smart.lastBatch ?? [];
  const isOpen = !!smart.dashboardOpen;

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
      {/* Right-edge tab removed — Stats auto-opens on batch completion;
          there's no LeftNav entry yet because the panel only has data
          after a Smart Mode reset. */}

      {/* Slide-in panel */}
      <aside
        data-testid="batch-dashboard"
        data-runs={rows.length}
        data-open={isOpen ? 'true' : 'false'}
        style={`position: fixed; top: 56px; right: 0; bottom: 0; width: min(540px, 95vw); z-index: 60; overflow-y: auto; background: rgba(255,255,255,0.62); backdrop-filter: blur(18px) saturate(150%); -webkit-backdrop-filter: blur(18px) saturate(150%); border-left: 1px solid rgba(15,23,42,0.06); box-shadow: -8px 0 24px rgba(15,23,42,0.06); transform: translateX(${isOpen ? '0' : '100%'}); transition: transform 0.22s ease-out;`}
      >
        <div style="padding: 14px 14px 24px; display: flex; flex-direction: column; gap: 12px;">
          {/* Header */}
          <header style="display: flex; align-items: center; justify-content: space-between;">
            <h2 style="margin: 0; font-size: 15px; font-weight: 600; color: #0f172a; letter-spacing: -0.005em; display: flex; align-items: center; gap: 8px;">
              <span style="color: #f59e0b; display: inline-flex;"><IconStar size={16} /></span>
              Batch Dashboard
            </h2>
            <button
              type="button"
              data-testid="batch-dashboard-close"
              onClick$={close}
              aria-label="Close panel"
              style="display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; background: transparent; border: 0; color: #64748b; cursor: pointer; border-radius: 6px;"
            >
              <IconClose size={16} />
            </button>
          </header>

          {/* Empty state — when opened via the LeftNav before any batch
              has run, give the user a hint instead of a blank panel. */}
          {rows.length === 0 && !smart.batchProgress && (
            <div
              data-testid="batch-dashboard-empty"
              style="padding: 36px 24px; text-align: center; background: rgba(255,255,255,0.55); backdrop-filter: blur(12px) saturate(140%); -webkit-backdrop-filter: blur(12px) saturate(140%); border: 1px dashed rgba(15,23,42,0.12); border-radius: 12px; color: #64748b;"
            >
              <div style="display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 999px; background: rgba(245,158,11,0.10); color: #f59e0b; margin-bottom: 12px;">
                <IconStar size={22} />
              </div>
              <div style="font-size: 14px; font-weight: 600; color: #0f172a; margin-bottom: 4px;">No batch yet</div>
              <div style="font-size: 13px;">
                Run a Smart Mode reset from Controls to populate the dashboard.<br />
                Bar chart, Pareto plot, and per-run table will appear here.
              </div>
            </div>
          )}

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
                const isHovered = smart.hoveredRunIdx === r.idx;
                const isSelected = smart.selectedRunIdx === r.idx;
                const isAccent = isHovered || isSelected;
                // Single accent palette: amber for hover/select/best, slate for the rest.
                // Below-floor runs get a slightly lighter slate so they recede.
                const fill = isAccent
                  ? '#f59e0b'
                  : isBest
                    ? '#fbbf24'
                    : r.playerRelevantWords >= game.minWordsPerBoard
                      ? '#94a3b8'
                      : '#cbd5e1';
                const opacity = (smart.selectedRunIdx != null && !isSelected) ? 0.45 : 1;
                return (
                  <g
                    key={`bar-${r.idx}`}
                    style="cursor: pointer;"
                    onMouseEnter$={() => setHover(r.idx)}
                    onMouseLeave$={() => setHover(null)}
                    onClick$={() => toggleSelect(r.idx)}
                  >
                    <rect
                      data-testid="batch-chart-bar"
                      data-run-idx={r.idx}
                      data-selected={isSelected ? 'true' : 'false'}
                      data-hovered={isHovered ? 'true' : 'false'}
                      x={x}
                      y={y}
                      width={barW * 0.8}
                      height={Math.max(0, h)}
                      fill={fill}
                      rx={2}
                      opacity={opacity}
                      style="transition: fill 0.15s ease-out, opacity 0.15s;"
                    />
                    {(barRows.length <= 25 || isAccent) && (
                      <text
                        x={x + barW * 0.4}
                        y={y - 4}
                        font-size={9}
                        fill={isAccent ? '#92400e' : '#64748b'}
                        text-anchor="middle"
                        font-weight={isAccent || isBest ? 700 : 400}
                        style="pointer-events: none; transition: fill 0.15s;"
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
                const isHovered = smart.hoveredRunIdx === r.idx;
                const isSelected = smart.selectedRunIdx === r.idx;
                const isAccent = isHovered || isSelected;
                const radius = isAccent ? 7 : isBest ? 6 : 4;
                const fill = isAccent
                  ? '#f59e0b'
                  : isBest
                    ? '#fbbf24'
                    : isFrontier
                      ? '#16a34a'
                      : '#cbd5e1';
                const opacity = (smart.selectedRunIdx != null && !isSelected) ? 0.45 : 1;
                return (
                  <circle
                    key={`pt-${r.idx}`}
                    data-testid="batch-chart-point"
                    data-run-idx={r.idx}
                    data-selected={isSelected ? 'true' : 'false'}
                    cx={xToPx(r.elapsedMs)}
                    cy={yToPx2(r.playerRelevantWords)}
                    r={radius}
                    fill={fill}
                    stroke={isAccent ? '#92400e' : '#fff'}
                    stroke-width={isAccent ? 2 : 1.25}
                    opacity={opacity}
                    style="cursor: pointer; transition: r 0.15s, fill 0.15s, opacity 0.15s;"
                    onMouseEnter$={() => setHover(r.idx)}
                    onMouseLeave$={() => setHover(null)}
                    onClick$={() => toggleSelect(r.idx)}
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
                    const isHovered = smart.hoveredRunIdx === r.idx;
                    const isSelected = smart.selectedRunIdx === r.idx;
                    const alreadyFav = !!profile.profile?.favoriteBoards.some(
                      (f) => f.board === r.board && f.source === 'batch'
                    );
                    const rowBg = isSelected
                      ? 'rgba(245,158,11,0.18)'
                      : isHovered
                        ? 'rgba(245,158,11,0.08)'
                        : '';
                    return (
                      <tr
                        key={r.idx}
                        data-testid="batch-table-row"
                        data-run-idx={r.idx}
                        data-is-best={isBest ? 'true' : 'false'}
                        data-selected={isSelected ? 'true' : 'false'}
                        data-hovered={isHovered ? 'true' : 'false'}
                        onMouseEnter$={() => setHover(r.idx)}
                        onMouseLeave$={() => setHover(null)}
                        onClick$={() => toggleSelect(r.idx)}
                        style={`cursor: pointer; ${rowBg ? `background: ${rowBg} !important;` : ''} transition: background 0.15s ease-out;`}
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
                            onClick$={(e) => { e.stopPropagation(); loadIntoGame(r); }}
                            class="glass-btn-icon"
                            title="Load this board into the game"
                          >
                            ↩
                          </button>
                          <button
                            type="button"
                            data-testid="batch-table-thumb-up"
                            data-favorited={alreadyFav ? 'true' : 'false'}
                            onClick$={(e) => { e.stopPropagation(); rateRow(r, 1); }}
                            class="glass-btn-icon"
                            title={alreadyFav ? 'Already saved to your favorites' : 'Save this board to your profile + rate it good'}
                            style={alreadyFav ? 'background: rgba(245,158,11,0.18); border-color: #f59e0b; color: #92400e;' : ''}
                          >
                            {alreadyFav ? '⭐' : '👍'}
                          </button>
                          <button
                            type="button"
                            data-testid="batch-table-thumb-down"
                            onClick$={(e) => { e.stopPropagation(); rateRow(r, 0); }}
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
