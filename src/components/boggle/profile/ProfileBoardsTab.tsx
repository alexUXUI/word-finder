import { $, component$, useContext, useSignal, type QRL } from '@builder.io/qwik';
import { ProfileCtx } from '../context';
import { removeFavoriteBoard } from './api';
import type { FavoriteBoard } from './types';
import { IconClose, IconStar } from '../../shell/icons';

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
const RARE = new Set(['j', 'k', 'q', 'v', 'x', 'y', 'z']);

interface BoardMetrics {
  vowelRatio: number;
  rareCount: number;
  distinctLetters: number;
  /** Shannon entropy in bits over the 26-letter distribution. */
  entropy: number;
}

const computeMetrics = (board: string): BoardMetrics => {
  const chars = board.toLowerCase().split('').filter((c) => /[a-z]/.test(c));
  const total = chars.length || 1;
  const counts = new Map<string, number>();
  for (const c of chars) counts.set(c, (counts.get(c) ?? 0) + 1);
  let vowels = 0;
  let rare = 0;
  for (const [c, n] of counts) {
    if (VOWELS.has(c)) vowels += n;
    if (RARE.has(c)) rare += n;
  }
  let entropy = 0;
  for (const n of counts.values()) {
    const p = n / total;
    entropy -= p * Math.log2(p);
  }
  return {
    vowelRatio: vowels / total,
    rareCount: rare,
    distinctLetters: counts.size,
    entropy,
  };
};

/**
 * Favorite Boards tab — grid of saved boards. Each card shows a small
 * letter-grid preview, the score, and a "Play this board" CTA.
 */
export const ProfileBoardsTab = component$(() => {
  const profile = useContext(ProfileCtx);
  const me = profile.profile;
  if (!me) return null;
  const boards = me.favoriteBoards;

  const remove = $(async (id: string) => {
    profile.pendingMutation = true;
    try {
      await removeFavoriteBoard(profile.playerId, id);
      if (me) me.favoriteBoards = me.favoriteBoards.filter((b) => b.id !== id);
    } catch (e) {
      profile.loadError = e instanceof Error ? e.message : String(e);
    } finally {
      profile.pendingMutation = false;
    }
  });

  if (boards.length === 0) {
    return (
      <div
        data-testid="profile-tab-body-boards"
        style="padding: 36px 24px; text-align: center; background: rgba(255,255,255,0.55); backdrop-filter: blur(12px) saturate(140%); -webkit-backdrop-filter: blur(12px) saturate(140%); border: 1px dashed rgba(15,23,42,0.12); border-radius: 12px; color: #64748b;"
      >
        <div style="display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 999px; background: rgba(245,158,11,0.10); color: #f59e0b; margin-bottom: 12px;">
          <IconStar size={22} />
        </div>
        <div style="font-size: 14px; font-weight: 600; color: #0f172a; margin-bottom: 4px;">No favorite boards yet</div>
        <div style="font-size: 13px;">
          Save a board from the Batch Dashboard during play and it'll show up here.
        </div>
      </div>
    );
  }

  return (
    <div data-testid="profile-tab-body-boards" style="display: flex; flex-direction: column; gap: 18px;">
      <BoardsComparison boards={boards} />
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px;">
        {boards.map((b) => (
          <BoardCard key={b.id} board={b} onRemove$={remove} />
        ))}
      </div>
    </div>
  );
});

interface BoardsComparisonProps {
  boards: FavoriteBoard[];
}

/**
 * Comparison view above the boards grid — at-a-glance summary across all
 * favorites: stats strip + sortable table with computed metrics + a small
 * horizontal-bar chart of scores. Hovering a row highlights the bar and
 * vice-versa (cross-chart linking).
 */
export const BoardsComparison = component$<BoardsComparisonProps>(({ boards }) => {
  const hoveredId = useSignal<string | null>(null);

  const enriched = boards.map((b) => ({ ...b, metrics: computeMetrics(b.board) }));
  const maxScore = Math.max(1, ...enriched.map((b) => b.score));
  const meanScore = enriched.reduce((s, b) => s + b.score, 0) / Math.max(1, enriched.length);
  const meanVowel = enriched.reduce((s, b) => s + b.metrics.vowelRatio, 0) / Math.max(1, enriched.length);

  return (
    <section
      style="background: rgba(255,255,255,0.55); backdrop-filter: blur(12px) saturate(140%); -webkit-backdrop-filter: blur(12px) saturate(140%); border: 1px solid rgba(15,23,42,0.06); border-radius: 14px; padding: 18px; box-shadow: 0 1px 3px rgba(15,23,42,0.04); display: flex; flex-direction: column; gap: 16px;"
    >
      {/* Stats strip */}
      <div style="display: flex; flex-wrap: wrap; gap: 24px; align-items: baseline;">
        <Stat label="Saved" value={String(boards.length)} testId="bc-stat-count" />
        <Stat label="Mean score" value={meanScore.toFixed(1)} testId="bc-stat-mean" />
        <Stat label="Best score" value={String(maxScore)} testId="bc-stat-best" />
        <Stat label="Mean vowel %" value={`${(meanVowel * 100).toFixed(0)}%`} testId="bc-stat-vowel" />
      </div>

      {/* Bar chart of scores */}
      <div>
        <div style="font-size: 10px; font-weight: 700; color: #94a3b8; letter-spacing: 0.10em; text-transform: uppercase; margin-bottom: 8px;">
          Score by board
        </div>
        <div data-testid="bc-bars" style="display: flex; flex-direction: column; gap: 4px;">
          {[...enriched].sort((a, b) => b.score - a.score).map((b) => {
            const widthPct = (b.score / maxScore) * 100;
            const isAccent = hoveredId.value === b.id;
            return (
              <div
                key={b.id}
                data-testid="bc-bar-row"
                data-board-id={b.id}
                data-hovered={isAccent ? 'true' : 'false'}
                onMouseEnter$={() => (hoveredId.value = b.id)}
                onMouseLeave$={() => (hoveredId.value = null)}
                style="display: flex; align-items: center; gap: 10px; cursor: pointer;"
              >
                <span style="font-size: 10px; font-family: ui-monospace, monospace; color: #94a3b8; width: 56px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  {b.board.slice(0, 6)}…
                </span>
                <div style="flex: 1; height: 14px; background: rgba(15,23,42,0.04); border-radius: 4px; overflow: hidden; position: relative;">
                  <div
                    style={`height: 100%; width: ${widthPct}%; background: ${isAccent ? '#f59e0b' : 'rgba(245,158,11,0.55)'}; transition: background 0.12s;`}
                  />
                </div>
                <span style="font-size: 12px; font-weight: 600; color: #0f172a; font-variant-numeric: tabular-nums; width: 32px; text-align: right;">
                  {b.score}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Metrics table */}
      <div style="overflow-x: auto;">
        <div style="font-size: 10px; font-weight: 700; color: #94a3b8; letter-spacing: 0.10em; text-transform: uppercase; margin-bottom: 8px;">
          Metrics
        </div>
        <table data-testid="bc-table" style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <thead>
            <tr style="color: #64748b; text-align: left;">
              <th style="padding: 6px 8px; font-weight: 600;">Board</th>
              <th style="padding: 6px 8px; font-weight: 600; text-align: right;">Score</th>
              <th style="padding: 6px 8px; font-weight: 600; text-align: right;">Vowel %</th>
              <th style="padding: 6px 8px; font-weight: 600; text-align: right;">Distinct</th>
              <th style="padding: 6px 8px; font-weight: 600; text-align: right;">Rare</th>
              <th style="padding: 6px 8px; font-weight: 600; text-align: right;">Entropy</th>
            </tr>
          </thead>
          <tbody>
            {enriched.map((b) => {
              const isAccent = hoveredId.value === b.id;
              return (
                <tr
                  key={b.id}
                  data-testid="bc-table-row"
                  data-board-id={b.id}
                  data-hovered={isAccent ? 'true' : 'false'}
                  onMouseEnter$={() => (hoveredId.value = b.id)}
                  onMouseLeave$={() => (hoveredId.value = null)}
                  style={`color: #0f172a; background: ${isAccent ? 'rgba(245,158,11,0.08)' : 'transparent'}; transition: background 0.12s; cursor: pointer; border-top: 1px solid rgba(15,23,42,0.04);`}
                >
                  <td style="padding: 6px 8px; font-family: ui-monospace, monospace; font-size: 11px; color: #475569;">
                    {b.board.slice(0, 6)}…
                  </td>
                  <td style="padding: 6px 8px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600;">{b.score}</td>
                  <td style="padding: 6px 8px; text-align: right; font-variant-numeric: tabular-nums;">{(b.metrics.vowelRatio * 100).toFixed(0)}%</td>
                  <td style="padding: 6px 8px; text-align: right; font-variant-numeric: tabular-nums;">{b.metrics.distinctLetters}</td>
                  <td style="padding: 6px 8px; text-align: right; font-variant-numeric: tabular-nums;">{b.metrics.rareCount}</td>
                  <td style="padding: 6px 8px; text-align: right; font-variant-numeric: tabular-nums;">{b.metrics.entropy.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
});

const Stat = component$<{ label: string; value: string; testId: string }>(({ label, value, testId }) => (
  <div data-testid={testId} style="display: flex; flex-direction: column; gap: 2px;">
    <span style="font-size: 10px; font-weight: 700; color: #94a3b8; letter-spacing: 0.10em; text-transform: uppercase;">{label}</span>
    <span style="font-size: 18px; font-weight: 700; color: #0f172a; font-variant-numeric: tabular-nums; line-height: 1;">{value}</span>
  </div>
));

interface BoardCardProps {
  board: FavoriteBoard;
  onRemove$: QRL<(id: string) => void>;
}

export const BoardCard = component$<BoardCardProps>(({ board, onRemove$ }) => {
  const cells = board.board.split('');
  const savedAt = new Date(board.savedAt).toLocaleDateString();
  return (
    <article
      data-testid="profile-board-card"
      data-board-id={board.id}
      style="background: rgba(255,255,255,0.62); backdrop-filter: blur(12px) saturate(140%); -webkit-backdrop-filter: blur(12px) saturate(140%); border: 1px solid rgba(15,23,42,0.06); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 1px 3px rgba(15,23,42,0.04);"
    >
      <div
        style={`display: grid; grid-template-columns: repeat(${board.size}, 1fr); gap: 2px; aspect-ratio: 1; background: #f8fafc; padding: 6px; border-radius: 8px;`}
      >
        {cells.map((c, i) => (
          <span
            key={i}
            style="display: flex; align-items: center; justify-content: center; background: #fff; border: 1px solid #e2e8f0; border-radius: 4px; font-weight: 600; font-size: 12px; color: #0f172a; text-transform: uppercase;"
          >
            {c}
          </span>
        ))}
      </div>
      <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 8px;">
        <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
          <div style="font-size: 12px; color: #64748b;">
            score
          </div>
          <div style="font-size: 18px; font-weight: 700; color: #0f172a; line-height: 1; font-variant-numeric: tabular-nums;">
            {board.score}
          </div>
        </div>
        <div style="font-size: 11px; color: #94a3b8;">{savedAt}</div>
      </div>
      <div style="display: flex; gap: 6px;">
        <a
          href={`/?board=${encodeURIComponent(board.board)}`}
          data-testid="profile-board-play"
          style="flex: 1; padding: 8px 12px; background: #f59e0b; color: #fff; text-align: center; text-decoration: none; border-radius: 6px; font-size: 12px; font-weight: 600;"
        >
          Play this board
        </a>
        <button
          type="button"
          data-testid="profile-board-remove"
          onClick$={() => onRemove$(board.id)}
          aria-label="Remove favorite"
          style="display: inline-flex; align-items: center; justify-content: center; width: 36px; padding: 8px 10px; background: rgba(255,255,255,0.6); border: 1px solid rgba(15,23,42,0.08); color: #64748b; border-radius: 8px; cursor: pointer;"
        >
          <IconClose size={14} />
        </button>
      </div>
    </article>
  );
});
