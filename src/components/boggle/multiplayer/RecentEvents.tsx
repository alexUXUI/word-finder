import { component$, useContext } from '@builder.io/qwik';
import { MultiplayerCtx } from '../context';
import { colorForPlayer } from './colors';

/**
 * Sliding event feed — last ~5 server-side events. Each entry has a
 * fade/slide-in animation keyed by event id, so new events visually
 * appear from the bottom.
 */
export const RecentEvents = component$(() => {
  const mp = useContext(MultiplayerCtx);
  const events = mp.recentEvents.slice(-5);
  if (events.length === 0) return null;
  return (
    <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
      {events.map((e) => {
        const color = e.playerId ? colorForPlayer(e.playerId) : '#475569';
        return (
          <div
            key={e.id}
            data-testid="mp-event-line"
            style={`font-size: 12px; color: #475569; border-left: 3px solid ${color}; padding: 4px 8px; background: rgba(255,255,255,0.5); border-radius: 0 6px 6px 0; animation: mp-slide-in 0.25s ease-out;`}
          >
            {e.text}
          </div>
        );
      })}
    </div>
  );
});
