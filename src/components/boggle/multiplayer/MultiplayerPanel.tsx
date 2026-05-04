import { component$, useContext, $ } from '@builder.io/qwik';
import { MultiplayerCtx } from '../context';
import { JoinForm } from './JoinForm';
import { PlayerList } from './PlayerList';
import { RecentEvents } from './RecentEvents';
import { EndGameResults } from './EndGameResults';
import { IconBolt, IconClose } from '../../shell/icons';

/**
 * Root multiplayer panel: right-edge tab + slide-in aside following the
 * same pattern as BatchDashboard / PipelineLab. Switches between four
 * visual states based on (a) whether the WS client has joined a game and
 * (b) the server-reported game lifecycle.
 *
 * Owns presentation only. The WebSocket lifecycle (connect, board swap,
 * found-word emission) lives on BoggleRoot's visible-task so it can also
 * coordinate with the BoardCtx and the in-page game loop.
 */
export const MultiplayerPanel = component$(() => {
  const mp = useContext(MultiplayerCtx);

  const send = $((frame: 'start' | 'leave' | 'ready-on' | 'ready-off') => {
    const c = mp.refs.client;
    if (!c) return;
    if (frame === 'start') c.send({ type: 'start' });
    else if (frame === 'leave') c.send({ type: 'leave' });
    else c.send({ type: 'ready', ready: frame === 'ready-on' });
  });

  const close = $(() => { mp.panelOpen = false; });

  const game = mp.game;
  const lifecycleAttr =
    !game ? 'disconnected'
    : game.state === 'lobby' ? 'lobby'
    : game.state === 'playing' ? 'playing'
    : 'ended';

  const me = game?.players?.[mp.playerId];

  return (
    <>
      {/* Right-edge tab removed — panel is opened via the LeftNav's
          "Multiplayer" link (which sets the URL ?panel=multiplayer query
          that BoggleRoot watches). */}
      <aside
        data-testid="multiplayer-panel"
        data-state={lifecycleAttr}
        data-open={mp.panelOpen ? 'true' : 'false'}
        style={`position: fixed; top: 56px; right: 0; bottom: 0; width: min(380px, 95vw); z-index: 60; overflow-y: auto; background: rgba(255,255,255,0.62); backdrop-filter: blur(18px) saturate(150%); -webkit-backdrop-filter: blur(18px) saturate(150%); border-left: 1px solid rgba(15,23,42,0.06); box-shadow: -8px 0 24px rgba(15,23,42,0.06); transform: translateX(${mp.panelOpen ? '0' : '100%'}); transition: transform 0.22s ease-out;`}
      >
        <div style="padding: 14px 14px 24px; display: flex; flex-direction: column; gap: 12px; font-size: 13px;">
          <header style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <h2 style="margin: 0; font-size: 15px; font-weight: 600; color: #0f172a; letter-spacing: -0.005em; display: flex; align-items: center; gap: 8px;">
              <span style="color: #f59e0b; display: inline-flex;"><IconBolt size={16} /></span>
              {game?.displayName ?? 'Multiplayer'}
            </h2>
            <div style="display: flex; align-items: center; gap: 6px;">
              <ConnectionBadge />
              <button
                type="button"
                data-testid="mp-close"
                onClick$={close}
                aria-label="Close panel"
                style="display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; background: transparent; border: 0; color: #64748b; cursor: pointer; border-radius: 6px;"
              >
                <IconClose size={16} />
              </button>
            </div>
          </header>

          {mp.lastError && (
            <div
              data-testid="mp-error"
              style="padding: 6px 10px; border-radius: 6px; background: rgba(248,113,113,0.18); color: #b91c1c; font-size: 12px;"
            >
              {mp.lastError}
            </div>
          )}

          {/* Disconnected → show join form */}
          {!game && <JoinForm />}

          {/* Lobby */}
          {game && game.state === 'lobby' && (
            <div style="display: flex; flex-direction: column; gap: 10px;">
              <div style="font-size: 12px; color: #475569;">
                {Object.keys(game.players).length} player
                {Object.keys(game.players).length === 1 ? '' : 's'} in lobby
              </div>
              <PlayerList showWordCounts={false} showReadyState={false} />
              <button
                type="button"
                data-testid="mp-start"
                onClick$={() => send('start')}
                class="glass-btn"
                style="font-weight: 600;"
              >
                Start game
              </button>
              <button
                type="button"
                data-testid="mp-leave"
                onClick$={() => send('leave')}
                class="glass-btn"
                style="background: transparent; color: #b91c1c; font-size: 12px;"
              >
                Leave
              </button>
            </div>
          )}

          {/* Playing */}
          {game && game.state === 'playing' && (
            <div style="display: flex; flex-direction: column; gap: 10px;">
              <div style="font-size: 12px; color: #475569;">
                {timeSince(game.startedAt)} • {Object.values(game.players).filter((p) => p.connected).length} connected
              </div>
              <PlayerList showWordCounts={true} showReadyState={true} />

              <button
                type="button"
                data-testid="mp-ready-toggle"
                data-ready={me?.readyToEnd ? 'true' : 'false'}
                onClick$={() => send(me?.readyToEnd ? 'ready-off' : 'ready-on')}
                class="glass-btn"
                style={`font-weight: 600; ${me?.readyToEnd ? 'background: rgba(34,197,94,0.2); color: #166534;' : ''}`}
              >
                {me?.readyToEnd ? '✓ Ready to end (click to undo)' : "I'm ready to end"}
              </button>

              {me?.readyToEnd && (
                <div style="font-size: 11px; color: #64748b;">
                  Waiting on:{' '}
                  {Object.values(game.players)
                    .filter((p) => p.connected && !p.readyToEnd && p.id !== mp.playerId)
                    .map((p) => p.displayName)
                    .join(', ') || '(everyone is ready — ending now)'}
                </div>
              )}

              <RecentEvents />
            </div>
          )}

          {/* Ended */}
          {game && game.state === 'ended' && (
            <div style="display: flex; flex-direction: column; gap: 10px;">
              <EndGameResults />
              <button
                type="button"
                data-testid="mp-new-game"
                onClick$={() => send('leave')}
                class="glass-btn"
                style="font-weight: 600;"
              >
                Leave + new game
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
});

export const ConnectionBadge = component$(() => {
  const mp = useContext(MultiplayerCtx);
  const colors: Record<string, { bg: string; fg: string; label: string }> = {
    idle:         { bg: '#e2e8f0', fg: '#475569', label: 'idle' },
    connecting:   { bg: '#fef3c7', fg: '#92400e', label: '⟳ connecting' },
    connected:    { bg: '#dcfce7', fg: '#166534', label: '● live' },
    reconnecting: { bg: '#fef3c7', fg: '#92400e', label: '⟳ reconnecting' },
    closed:       { bg: '#e2e8f0', fg: '#475569', label: 'closed' },
    error:        { bg: '#fee2e2', fg: '#b91c1c', label: 'error' },
  };
  const c = colors[mp.connectionStatus] ?? colors.idle;
  return (
    <span
      data-testid="mp-connection-status"
      data-status={mp.connectionStatus}
      style={`font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 999px; background: ${c.bg}; color: ${c.fg}; letter-spacing: 0.02em; text-transform: uppercase;`}
    >
      {c.label}
    </span>
  );
});

export const timeSince = (startedAt: number | null): string => {
  if (!startedAt) return 'just started';
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s in`;
  const mins = Math.floor(seconds / 60);
  return `${mins}m ${seconds % 60}s in`;
};
