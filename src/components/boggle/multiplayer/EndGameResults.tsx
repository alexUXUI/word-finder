import { component$, useContext } from '@builder.io/qwik';
import { MultiplayerCtx } from '../context';
import { colorForPlayer } from './colors';

/**
 * Final-state view: leaderboard with unique-vs-shared breakdown for the
 * viewing player. The bars are scaled to the top scorer; ties share rank 1.
 */
export const EndGameResults = component$(() => {
  const mp = useContext(MultiplayerCtx);
  const results = mp.lastResults;
  if (!results) {
    return (
      <div style="font-size: 12px; color: #64748b;">
        Waiting for end-of-game results…
      </div>
    );
  }
  const max = Math.max(1, ...results.perPlayer.map((p) => p.points));
  const me = results.perPlayer.find((p) => p.playerId === mp.playerId);

  return (
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <div data-testid="mp-results-leaderboard" style="display: flex; flex-direction: column; gap: 6px;">
        {results.perPlayer.map((p) => {
          const isWinner = results.winnerIds.includes(p.playerId);
          const color = colorForPlayer(p.playerId);
          const isYou = p.playerId === mp.playerId;
          const widthPct = (p.points / max) * 100;
          return (
            <div
              key={p.playerId}
              data-testid="mp-results-row"
              data-rank={p.rank}
              data-points={p.points}
              style="position: relative; padding: 6px 10px; border-radius: 6px; overflow: hidden; background: rgba(255,255,255,0.5); border: 1px solid #1e3a8a30;"
            >
              <div
                aria-hidden="true"
                style={`position: absolute; left: 0; top: 0; bottom: 0; width: ${widthPct}%; background: ${color}; opacity: 0.18;`}
              />
              <div style="position: relative; display: flex; align-items: center; gap: 8px;">
                <span style="width: 24px; color: #475569; font-weight: 600;">
                  {isWinner ? '🏆' : `#${p.rank}`}
                </span>
                <span style={`flex: 1 1 auto; font-weight: ${isYou ? '700' : '500'}; color: ${color};`}>
                  {isYou ? 'You' : p.displayName}
                </span>
                <span style="font-variant-numeric: tabular-nums; font-weight: 700; color: #1e3a8a;">
                  {p.points}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {me && (
        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px;">
          <div>
            <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">
              ✨ Your unique words ({me.uniqueWords.length})
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 4px;">
              {me.uniqueWords.length === 0 ? (
                <span style="font-size: 12px; color: #94a3b8;">none — every word you found was also found by someone else</span>
              ) : me.uniqueWords.map((w) => (
                <span
                  key={w}
                  class="glass-card-accent"
                  style="padding: 2px 8px; font-size: 12px; color: #0e7490; font-weight: 600;"
                >
                  {w}
                </span>
              ))}
            </div>
          </div>
          {me.sharedWords.length > 0 && (
            <div>
              <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">
                Shared (zeroed) — {me.sharedWords.length}
              </div>
              <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                {me.sharedWords.map((w) => (
                  <span
                    key={w}
                    class="glass-card"
                    style="padding: 2px 8px; font-size: 12px; color: #94a3b8; text-decoration: line-through;"
                  >
                    {w}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
