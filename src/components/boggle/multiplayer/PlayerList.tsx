import { component$, useContext } from '@builder.io/qwik';
import { MultiplayerCtx } from '../context';
import { colorForPlayer } from './colors';

export interface PlayerListProps {
  showWordCounts: boolean;
  showReadyState: boolean;
}

/**
 * Live player list — used by both lobby and playing views. Each row is
 * keyed by playerId; the count number's `data-count` attribute changes
 * every time the server confirms a `player_found` for that player, which
 * the CSS animation hooks into to do a brief flash on update.
 */
export const PlayerList = component$<PlayerListProps>((props) => {
  const mp = useContext(MultiplayerCtx);
  const players = Object.values(mp.game?.players ?? {}).sort(
    (a, b) => a.joinedAt - b.joinedAt,
  );

  return (
    <div data-testid="mp-player-list" style="display: flex; flex-direction: column; gap: 6px;">
      {players.map((p) => {
        const isYou = p.id === mp.playerId;
        const color = colorForPlayer(p.id);
        return (
          <div
            key={p.id}
            data-testid="mp-player-row"
            data-player-id={p.id}
            data-connected={p.connected ? 'true' : 'false'}
            data-ready={p.readyToEnd ? 'true' : 'false'}
            data-word-count={p.foundWords.length}
            class="glass-card"
            style={`display: flex; align-items: center; gap: 8px; padding: 6px 10px; opacity: ${p.connected ? 1 : 0.55}; transition: opacity 0.2s;`}
          >
            <span
              aria-hidden="true"
              title={p.connected ? 'connected' : 'disconnected'}
              style={`width: 8px; height: 8px; border-radius: 50%; background: ${p.connected ? '#22c55e' : '#94a3b8'}; flex: 0 0 auto; box-shadow: 0 0 0 2px ${p.connected ? 'rgba(34,197,94,0.25)' : 'transparent'}; transition: background 0.2s, box-shadow 0.2s;`}
            />
            <span
              style={`font-weight: ${isYou ? '700' : '500'}; color: ${color}; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`}
            >
              {isYou ? 'You' : p.displayName}
              {isYou && p.displayName !== 'You' && (
                <span style="color: #64748b; font-weight: 400;"> ({p.displayName})</span>
              )}
            </span>
            {props.showReadyState && p.readyToEnd && (
              <span
                title="ready to end"
                style="font-size: 11px; color: #16a34a; font-weight: 600;"
              >
                ✓ ready
              </span>
            )}
            {props.showWordCounts && (
              <span
                key={`${p.id}-${p.foundWords.length}`}
                style={`font-variant-numeric: tabular-nums; font-weight: 600; color: ${color}; min-width: 28px; text-align: right; animation: mp-pulse 0.4s ease-out;`}
              >
                {p.foundWords.length}
              </span>
            )}
          </div>
        );
      })}
      {players.length === 0 && (
        <div style="font-size: 12px; color: #64748b; padding: 4px;">
          Nobody here yet — share the game name with a friend.
        </div>
      )}
    </div>
  );
});
