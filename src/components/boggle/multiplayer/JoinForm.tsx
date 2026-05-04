import { component$, useContext, $, useSignal } from '@builder.io/qwik';
import { MultiplayerCtx } from '../context';

/**
 * Disconnected-state view: collect game name + display name and trigger
 * the connect flow. The actual WS lifecycle lives on BoggleRoot's visible
 * task — we just set the input fields and flip a flag the task watches.
 */
export const JoinForm = component$(() => {
  const mp = useContext(MultiplayerCtx);
  const localGame = useSignal(mp.pendingGameName);
  const localName = useSignal(mp.displayName);

  const submit = $(() => {
    const game = localGame.value.trim().toLowerCase();
    const name = localName.value.trim();
    if (!game || !name) return;
    mp.pendingGameName = game;
    mp.displayName = name;
  });

  return (
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <label style="display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #475569;">
        Game name
        <input
          data-testid="mp-game-name-input"
          value={localGame.value}
          onInput$={(e, el) => (localGame.value = el.value)}
          placeholder="alex's saturday game"
          maxLength={48}
          class="glass-card"
          style="padding: 8px 10px; font-size: 14px; color: #1e3a8a;"
        />
      </label>
      <label style="display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #475569;">
        Your display name
        <input
          data-testid="mp-display-name-input"
          value={localName.value}
          onInput$={(e, el) => (localName.value = el.value)}
          placeholder="Alex"
          maxLength={24}
          class="glass-card"
          style="padding: 8px 10px; font-size: 14px; color: #1e3a8a;"
        />
      </label>
      <button
        type="button"
        data-testid="mp-join"
        onClick$={submit}
        disabled={!localGame.value.trim() || !localName.value.trim()}
        class="glass-btn"
        style="font-weight: 600;"
      >
        Join game
      </button>

      {mp.recentGames.length > 0 && (
        <div style="margin-top: 8px;">
          <div style="font-size: 11px; color: #64748b; margin-bottom: 4px;">Recent</div>
          <div style="display: flex; flex-wrap: wrap; gap: 4px;">
            {mp.recentGames.slice(0, 5).map((g) => (
              <button
                key={g}
                type="button"
                data-testid="mp-recent-game"
                onClick$={() => (localGame.value = g)}
                class="glass-card"
                style="padding: 4px 8px; font-size: 12px; color: #1e3a8a; cursor: pointer; border: 1px solid #1e3a8a30;"
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
