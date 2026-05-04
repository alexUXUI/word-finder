import { $, component$, useContext, useSignal, type QRL } from '@builder.io/qwik';
import { ProfileCtx } from '../context';
import { Avatar } from '../../shell/Avatar';
import { addFriend, removeFriend } from './api';
import type { FriendEntry, RecentPlayer } from './types';

/**
 * Friends tab — list of currently-followed players + a recent-players
 * panel from your last few multiplayer games. Add-friend by playerId.
 * v1 is one-way follow (no consent flow).
 */
export const ProfileFriendsTab = component$(() => {
  const profile = useContext(ProfileCtx);
  const me = profile.profile;
  if (!me) return null;

  const newId = useSignal('');
  const newName = useSignal('');

  const add = $(async () => {
    const id = newId.value.trim();
    const name = newName.value.trim() || 'anonymous';
    if (!id || id === profile.playerId) return;
    profile.pendingMutation = true;
    try {
      const res = await addFriend(profile.playerId, id, { displayName: name });
      if (!res.alreadyExists && me) {
        me.friends = [res.friend, ...me.friends];
      }
      newId.value = '';
      newName.value = '';
    } catch (e) {
      profile.loadError = e instanceof Error ? e.message : String(e);
    } finally {
      profile.pendingMutation = false;
    }
  });

  const drop = $(async (id: string) => {
    profile.pendingMutation = true;
    try {
      await removeFriend(profile.playerId, id);
      if (me) me.friends = me.friends.filter((f) => f.playerId !== id);
    } catch (e) {
      profile.loadError = e instanceof Error ? e.message : String(e);
    } finally {
      profile.pendingMutation = false;
    }
  });

  const addFromRecent = $(async (rp: RecentPlayer) => {
    profile.pendingMutation = true;
    try {
      const res = await addFriend(profile.playerId, rp.playerId, { displayName: rp.displayName });
      if (!res.alreadyExists && me) {
        me.friends = [res.friend, ...me.friends];
      }
    } catch (e) {
      profile.loadError = e instanceof Error ? e.message : String(e);
    } finally {
      profile.pendingMutation = false;
    }
  });

  return (
    <div data-testid="profile-tab-body-friends" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
      {/* Friends list */}
      <section style="background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px;">
        <h2 style="margin: 0 0 12px; font-size: 11px; font-weight: 700; color: #94a3b8; letter-spacing: 0.08em; text-transform: uppercase;">
          Friends ({me.friends.length})
        </h2>

        <div style="display: flex; gap: 6px; margin-bottom: 14px;">
          <input
            data-testid="profile-friend-id-input"
            value={newId.value}
            onInput$={(e, el) => (newId.value = el.value)}
            placeholder="player UUID"
            style="flex: 2; padding: 7px 10px; font-size: 12px; border: 1px solid #e2e8f0; border-radius: 6px; font-family: ui-monospace, monospace;"
          />
          <input
            data-testid="profile-friend-name-input"
            value={newName.value}
            onInput$={(e, el) => (newName.value = el.value)}
            placeholder="name"
            style="flex: 1; padding: 7px 10px; font-size: 12px; border: 1px solid #e2e8f0; border-radius: 6px;"
          />
          <button
            type="button"
            data-testid="profile-friend-add"
            onClick$={add}
            disabled={!newId.value.trim()}
            style="padding: 7px 14px; background: #f59e0b; color: #fff; border: 0; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 12px;"
          >
            Add
          </button>
        </div>

        {me.friends.length === 0 ? (
          <div style="font-size: 13px; color: #94a3b8; text-align: center; padding: 16px;">
            No friends yet. Add by player UUID, or from Recent players →
          </div>
        ) : (
          <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px;">
            {me.friends.map((f) => (
              <FriendRow key={f.playerId} friend={f} onDrop$={drop} />
            ))}
          </ul>
        )}
      </section>

      {/* Recent players */}
      <section style="background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px;">
        <h2 style="margin: 0 0 12px; font-size: 11px; font-weight: 700; color: #94a3b8; letter-spacing: 0.08em; text-transform: uppercase;">
          Recent players ({me.recentPlayers.length})
        </h2>
        {me.recentPlayers.length === 0 ? (
          <div style="font-size: 13px; color: #94a3b8; text-align: center; padding: 16px;">
            Players from your multiplayer games will show up here.
          </div>
        ) : (
          <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px;">
            {me.recentPlayers.map((rp) => {
              const alreadyFriend = me.friends.some((f) => f.playerId === rp.playerId);
              return (
                <li
                  key={rp.playerId}
                  data-testid="profile-recent-row"
                  data-player-id={rp.playerId}
                  style="display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-radius: 6px;"
                >
                  <Avatar playerId={rp.playerId} displayName={rp.displayName} size={28} />
                  <div style="flex: 1; min-width: 0;">
                    <div style="font-size: 13px; font-weight: 500; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                      {rp.displayName}
                    </div>
                    <div style="font-size: 11px; color: #94a3b8;">
                      {rp.lastGame}
                    </div>
                  </div>
                  {alreadyFriend ? (
                    <span style="font-size: 10px; color: #16a34a; font-weight: 600; padding: 2px 8px; background: #dcfce7; border-radius: 999px;">
                      friend
                    </span>
                  ) : (
                    <button
                      type="button"
                      data-testid="profile-recent-add-friend"
                      onClick$={() => addFromRecent(rp)}
                      style="padding: 4px 10px; background: transparent; border: 1px solid #e2e8f0; color: #475569; font-size: 11px; border-radius: 6px; cursor: pointer;"
                    >
                      + friend
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
});

interface FriendRowProps {
  friend: FriendEntry;
  onDrop$: QRL<(playerId: string) => void>;
}

export const FriendRow = component$<FriendRowProps>(({ friend, onDrop$ }) => (
  <li
    data-testid="profile-friend-row"
    data-player-id={friend.playerId}
    style="display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-radius: 6px;"
  >
    <Avatar playerId={friend.playerId} displayName={friend.displayName} size={28} />
    <div style="flex: 1; min-width: 0;">
      <div style="font-size: 13px; font-weight: 500; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        {friend.displayName}
      </div>
      <div style="font-size: 10px; color: #94a3b8; font-family: ui-monospace, monospace;">
        {friend.playerId.slice(0, 12)}…
      </div>
    </div>
    <button
      type="button"
      data-testid="profile-friend-remove"
      onClick$={() => onDrop$(friend.playerId)}
      aria-label="Remove friend"
      style="padding: 4px 8px; background: transparent; border: 0; color: #cbd5e1; font-size: 16px; cursor: pointer;"
    >
      ×
    </button>
  </li>
));
