import { $, component$, useContext, type QRL } from '@builder.io/qwik';
import { ProfileCtx } from '../context';
import { removeFavoriteBoard } from './api';
import type { FavoriteBoard } from './types';

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
      <div data-testid="profile-tab-body-boards" style="padding: 32px; text-align: center; background: #fff; border: 1px dashed #e2e8f0; border-radius: 12px; color: #64748b;">
        <div style="font-size: 32px; margin-bottom: 8px;">⭐</div>
        <div style="font-size: 14px; font-weight: 600; color: #0f172a; margin-bottom: 4px;">No favorite boards yet</div>
        <div style="font-size: 13px;">
          Hit 👍 on a row in the Batch Dashboard during play to save the board here.
        </div>
      </div>
    );
  }

  return (
    <div data-testid="profile-tab-body-boards" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px;">
      {boards.map((b) => (
        <BoardCard key={b.id} board={b} onRemove$={remove} />
      ))}
    </div>
  );
});

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
      style="background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px;"
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
          style="padding: 8px 10px; background: transparent; border: 1px solid #e2e8f0; color: #64748b; border-radius: 6px; cursor: pointer; font-size: 14px;"
        >
          ×
        </button>
      </div>
    </article>
  );
});
