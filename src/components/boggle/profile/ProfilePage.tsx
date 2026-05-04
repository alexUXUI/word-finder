import { $, component$, Slot, useContext, useSignal } from '@builder.io/qwik';
import { ProfileCtx } from '../context';
import { Avatar } from '../../shell/Avatar';
import { IconHome, IconStar, IconUsers, IconEdit, IconCheck, IconClose } from '../../shell/icons';
import { ProfileBoardsTab } from './ProfileBoardsTab';
import { ProfileFriendsTab } from './ProfileFriendsTab';
import { updateDisplayName } from './api';
import type { Component } from '@builder.io/qwik';

type Tab = 'overview' | 'boards' | 'friends';

export const TABS: Array<{ id: Tab; label: string; Icon: Component<{ size?: number; title?: string }> }> = [
  { id: 'overview', label: 'Overview', Icon: IconHome  },
  { id: 'boards',   label: 'Boards',   Icon: IconStar  },
  { id: 'friends',  label: 'Friends',  Icon: IconUsers },
];

/**
 * Player profile page — three tabs (Overview / Favorite Boards / Friends).
 * The avatar + name header sits above the tabs and stays visible across
 * tab switches.
 */
export const ProfilePage = component$(() => {
  const profile = useContext(ProfileCtx);
  const tab = useSignal<Tab>('overview');
  const editing = useSignal<boolean>(false);
  const draft = useSignal<string>('');

  const beginEdit = $(() => {
    draft.value = profile.profile?.displayName ?? '';
    editing.value = true;
  });

  const cancelEdit = $(() => { editing.value = false; });

  const save = $(async () => {
    const next = draft.value.trim();
    if (!next || next === profile.profile?.displayName) {
      editing.value = false;
      return;
    }
    profile.pendingMutation = true;
    try {
      const updated = await updateDisplayName(profile.playerId, next);
      profile.profile = updated;
      editing.value = false;
    } catch (e) {
      profile.loadError = e instanceof Error ? e.message : String(e);
    } finally {
      profile.pendingMutation = false;
    }
  });

  const me = profile.profile;
  const playerId = profile.playerId;

  return (
    <div data-testid="profile-page" style="max-width: 920px; margin: 0 auto; padding: 24px 16px 64px;">
      {/* Header — wraps on narrow viewports so the stats drop below the name */}
      <header style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px; flex-wrap: wrap;">
        <Avatar playerId={playerId} displayName={me?.displayName ?? ''} size={64} showOnlineDot />
        <div style="display: flex; flex-direction: column; gap: 4px; flex: 1 1 200px; min-width: 0;">
          {editing.value ? (
            <div style="display: flex; gap: 6px; align-items: center;">
              <input
                data-testid="profile-name-input"
                value={draft.value}
                onInput$={(e, el) => (draft.value = el.value)}
                onKeyDown$={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancelEdit(); }}
                placeholder="Your display name"
                maxLength={24}
                autoFocus
                style="font-size: 22px; font-weight: 700; color: #0f172a; padding: 4px 8px; border: 1px solid #e2e8f0; border-radius: 6px; min-width: 220px;"
              />
              <button
                type="button"
                data-testid="profile-name-save"
                onClick$={save}
                style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: #f59e0b; color: #fff; border: 0; border-radius: 8px; font-weight: 600; cursor: pointer;"
              >
                <IconCheck size={14} /> Save
              </button>
              <button
                type="button"
                onClick$={cancelEdit}
                style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: transparent; color: #64748b; border: 1px solid rgba(15,23,42,0.10); border-radius: 8px; cursor: pointer;"
              >
                <IconClose size={14} /> Cancel
              </button>
            </div>
          ) : (
            <div style="display: flex; align-items: center; gap: 10px;">
              <h1 data-testid="profile-name" style="margin: 0; font-size: 26px; font-weight: 700; color: #0f172a; letter-spacing: -0.01em;">
                {me?.displayName || 'Anonymous'}
              </h1>
              <button
                type="button"
                data-testid="profile-edit-name"
                onClick$={beginEdit}
                aria-label="Edit display name"
                style="display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.6); border: 1px solid rgba(15,23,42,0.10); color: #475569; padding: 4px 10px; border-radius: 8px; font-size: 12px; cursor: pointer; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);"
              >
                <IconEdit size={13} /> Edit
              </button>
            </div>
          )}
          <span style="font-size: 11px; color: #94a3b8; font-family: ui-monospace, monospace; word-break: break-all; line-height: 1.3;">
            {playerId || 'loading…'}
          </span>
        </div>
        <div style="display: flex; gap: 20px; flex: 0 0 auto;">
          <Stat label="Games" value={me?.playedGames?.length ?? 0} testId="profile-stat-games" />
          <Stat label="Boards" value={me?.favoriteBoards?.length ?? 0} testId="profile-stat-boards" />
          <Stat label="Friends" value={me?.friends?.length ?? 0} testId="profile-stat-friends" />
        </div>
      </header>

      {/* Tabs — horizontal scroll if too narrow to fit all three */}
      <nav role="tablist" style="display: flex; gap: 2px; border-bottom: 1px solid rgba(15,23,42,0.08); margin-bottom: 22px; overflow-x: auto; -webkit-overflow-scrolling: touch;">
        {TABS.map((t) => {
          const active = tab.value === t.id;
          const Icon = t.Icon;
          const id = t.id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              data-testid={`profile-tab-${id}`}
              data-active={active ? 'true' : 'false'}
              aria-selected={active}
              onClick$={() => (tab.value = id)}
              style={`padding: 10px 16px; background: transparent; border: 0; cursor: pointer; font-size: 13px; font-weight: ${active ? 600 : 500}; color: ${active ? '#0f172a' : '#64748b'}; border-bottom: 2px solid ${active ? '#f59e0b' : 'transparent'}; margin-bottom: -1px; display: flex; align-items: center; gap: 8px; transition: color 0.12s, border-color 0.12s; white-space: nowrap; flex: 0 0 auto;`}
            >
              <span style={`color: ${active ? '#0f172a' : '#94a3b8'}; display: inline-flex;`}>
                <Icon size={15} />
              </span>
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* Tab body */}
      {profile.loadStatus === 'loading' && !me && (
        <div style="padding: 32px; text-align: center; color: #94a3b8;">Loading profile…</div>
      )}
      {profile.loadStatus === 'error' && (
        <div style="padding: 12px; background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; border-radius: 8px; font-size: 13px;">
          Couldn't load profile: {profile.loadError ?? 'unknown error'}
        </div>
      )}

      {tab.value === 'overview' && me && <OverviewTab />}
      {tab.value === 'boards' && me && <ProfileBoardsTab />}
      {tab.value === 'friends' && me && <ProfileFriendsTab />}
    </div>
  );
});

export const Stat = component$<{ label: string; value: number; testId: string }>(({ label, value, testId }) => (
  <div data-testid={testId} style="text-align: right; min-width: 64px;">
    <div style="font-size: 22px; font-weight: 700; color: #0f172a; line-height: 1; font-variant-numeric: tabular-nums;">{value}</div>
    <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px;">{label}</div>
  </div>
));

export const OverviewTab = component$(() => {
  const profile = useContext(ProfileCtx);
  const me = profile.profile;
  if (!me) return null;
  const created = new Date(me.createdAt).toLocaleDateString();
  const lastUpdated = new Date(me.updatedAt).toLocaleDateString();
  return (
    <div data-testid="profile-tab-body-overview" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px;">
      <Card title="About" testId="profile-card-about">
        <KV label="Display name" value={me.displayName || '(unset)'} />
        <KV label="Created" value={created} />
        <KV label="Last updated" value={lastUpdated} />
      </Card>
      <Card title="Activity" testId="profile-card-activity">
        <KV label="Games played" value={`${me.playedGames?.length ?? 0}`} />
        <KV label="Favorite boards" value={`${me.favoriteBoards.length}`} />
        <KV label="Friends" value={`${me.friends.length}`} />
        <KV label="Recent players" value={`${me.recentPlayers.length}`} />
      </Card>
    </div>
  );
});

export const Card = component$<{ title: string; testId: string }>(({ title, testId }) => (
  <section
    data-testid={testId}
    style="background: rgba(255,255,255,0.55); backdrop-filter: blur(12px) saturate(140%); -webkit-backdrop-filter: blur(12px) saturate(140%); border: 1px solid rgba(15,23,42,0.06); border-radius: 12px; padding: 18px; box-shadow: 0 1px 3px rgba(15,23,42,0.04);"
  >
    <h2 style="margin: 0 0 12px; font-size: 10px; font-weight: 700; color: #94a3b8; letter-spacing: 0.10em; text-transform: uppercase;">
      {title}
    </h2>
    <div style="display: flex; flex-direction: column; gap: 10px;"><Slot /></div>
  </section>
));

export const KV = component$<{ label: string; value: string }>(({ label, value }) => (
  <div style="display: flex; justify-content: space-between; gap: 8px; font-size: 13px;">
    <span style="color: #64748b;">{label}</span>
    <span style="color: #0f172a; font-weight: 500;">{value}</span>
  </div>
));

