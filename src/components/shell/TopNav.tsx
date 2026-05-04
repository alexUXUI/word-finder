import { $, component$, useContext, useTask$ } from '@builder.io/qwik';
import { useLocation } from '@builder.io/qwik-city';
import { ProfileCtx } from '../boggle/context';
import { Avatar } from './Avatar';
import { updateDisplayName } from '../boggle/profile/api';

export const PAGE_TITLES: Record<string, string> = {
  '/':         'Word Finder',
  '/profile/': 'Profile',
};

/**
 * Top bar — fixed-position. Logo + current-page title on the left, profile
 * avatar with dropdown menu on the right. Classic dashboard chrome.
 */
export const TopNav = component$(() => {
  const profile = useContext(ProfileCtx);
  const loc = useLocation();

  // Close the avatar menu on Escape or click-away.
  useTask$(({ track, cleanup }) => {
    const open = track(() => profile.avatarMenuOpen);
    if (!open || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') profile.avatarMenuOpen = false; };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t && !t.closest('[data-testid="avatar-menu"]') && !t.closest('[data-testid="topnav-avatar-button"]')) {
        profile.avatarMenuOpen = false;
      }
    };
    window.addEventListener('keydown', onKey);
    // Defer the click-away listener by a tick so the click that opened the
    // menu doesn't immediately re-close it.
    const id = setTimeout(() => window.addEventListener('click', onClick), 0);
    cleanup(() => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
      clearTimeout(id);
    });
  });

  const title = PAGE_TITLES[loc.url.pathname] ?? 'Word Finder';
  const displayName = profile.profile?.displayName || '';
  const playerId = profile.playerId;

  const renameInline = $(async () => {
    const next = window.prompt('Display name', displayName)?.trim();
    if (!next || next === displayName) return;
    profile.pendingMutation = true;
    try {
      const updated = await updateDisplayName(playerId, next);
      profile.profile = updated;
    } catch (e) {
      console.error('updateDisplayName failed', e);
    } finally {
      profile.pendingMutation = false;
      profile.avatarMenuOpen = false;
    }
  });

  return (
    <header
      data-testid="topnav"
      style="position: fixed; top: 0; left: 0; right: 0; height: 56px; z-index: 90; background: rgba(255,255,255,0.92); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; padding: 0 18px;"
    >
      <a
        href="/"
        data-testid="topnav-logo"
        style="display: flex; align-items: center; gap: 10px; text-decoration: none; color: #0f172a;"
      >
        <span aria-hidden="true" style="font-size: 18px;">📖</span>
        <span style="font-weight: 700; font-size: 14px; letter-spacing: 0.02em;">Word Finder</span>
        <span aria-hidden="true" style="color: #cbd5e1; margin: 0 6px;">/</span>
        <span data-testid="topnav-title" style="font-size: 13px; color: #64748b; font-weight: 500;">
          {title}
        </span>
      </a>

      <div style="position: relative; display: flex; align-items: center; gap: 10px;">
        {playerId && (
          <button
            type="button"
            data-testid="topnav-avatar-button"
            onClick$={() => (profile.avatarMenuOpen = !profile.avatarMenuOpen)}
            aria-haspopup="menu"
            aria-expanded={profile.avatarMenuOpen ? 'true' : 'false'}
            style="display: flex; align-items: center; gap: 8px; background: transparent; border: 0; padding: 4px 6px 4px 4px; border-radius: 999px; cursor: pointer;"
          >
            <Avatar playerId={playerId} displayName={displayName} size={32} />
            <span style="font-size: 12px; color: #475569; font-weight: 500; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              {displayName || 'Set name'}
            </span>
          </button>
        )}

        {profile.avatarMenuOpen && (
          <div
            role="menu"
            data-testid="avatar-menu"
            style="position: absolute; top: 44px; right: 0; min-width: 220px; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; box-shadow: 0 10px 24px rgba(15,23,42,0.10), 0 2px 4px rgba(15,23,42,0.04); padding: 6px; display: flex; flex-direction: column; gap: 2px; z-index: 100;"
          >
            <div style="padding: 10px 10px 6px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #f1f5f9; margin-bottom: 4px;">
              <Avatar playerId={playerId} displayName={displayName} size={36} />
              <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
                <span style="font-size: 13px; font-weight: 600; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  {displayName || 'Anonymous'}
                </span>
                <span style="font-size: 10px; color: #94a3b8; font-family: ui-monospace, monospace;">
                  {playerId.slice(0, 8)}…
                </span>
              </div>
            </div>
            <a
              href="/profile/"
              data-testid="avatar-menu-profile"
              onClick$={() => (profile.avatarMenuOpen = false)}
              style="padding: 8px 10px; border-radius: 6px; text-decoration: none; color: #0f172a; font-size: 13px; display: flex; align-items: center; gap: 8px;"
            >
              <span aria-hidden="true">👤</span> View profile
            </a>
            <button
              type="button"
              data-testid="avatar-menu-rename"
              onClick$={renameInline}
              style="padding: 8px 10px; border-radius: 6px; background: transparent; border: 0; color: #0f172a; font-size: 13px; text-align: left; display: flex; align-items: center; gap: 8px; cursor: pointer;"
            >
              <span aria-hidden="true">✏️</span> Rename
            </button>
          </div>
        )}
      </div>
    </header>
  );
});

export const TOP_NAV_HEIGHT = 56;
