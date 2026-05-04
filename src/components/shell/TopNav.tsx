import { $, component$, useContext, useTask$ } from '@builder.io/qwik';
import { useLocation } from '@builder.io/qwik-city';
import { ProfileCtx } from '../boggle/context';
import { Avatar } from './Avatar';
import { updateDisplayName } from '../boggle/profile/api';
import {
  IconClose,
  IconEdit,
  IconHamburger,
  IconLogo,
  IconUser,
} from './icons';

export const PAGE_TITLES: Record<string, string> = {
  '/':         'Word Finder',
  '/profile/': 'Profile',
};

/**
 * Top bar — fixed-position frosted-glass shell. Logo + page title on the
 * left, profile avatar with dropdown menu on the right. No emoji — all
 * iconography is inline SVG (see ./icons.tsx).
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
    const id = setTimeout(() => window.addEventListener('click', onClick), 0);
    cleanup(() => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
      clearTimeout(id);
    });
  });

  const title = PAGE_TITLES[loc.url.pathname] ?? '';
  const displayName = profile.profile?.displayName || '';
  const playerId = profile.playerId;
  const showBreadcrumb = title && title !== 'Word Finder';
  const compact = profile.isCompactViewport;

  return (
    <header
      data-testid="topnav"
      style="position: fixed; top: 0; left: 0; right: 0; height: 56px; z-index: 90; background: rgba(255,255,255,0.55); backdrop-filter: blur(14px) saturate(140%); -webkit-backdrop-filter: blur(14px) saturate(140%); border-bottom: 1px solid rgba(15,23,42,0.06); display: flex; align-items: center; justify-content: space-between; padding: 0 14px;"
    >
      <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
        {compact && (
          <button
            type="button"
            data-testid="topnav-hamburger"
            aria-label={profile.navDrawerOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={profile.navDrawerOpen ? 'true' : 'false'}
            onClick$={() => (profile.navDrawerOpen = !profile.navDrawerOpen)}
            style="display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; background: rgba(255,255,255,0.5); border: 1px solid rgba(15,23,42,0.08); border-radius: 8px; color: #334155; cursor: pointer; flex: 0 0 auto; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);"
          >
            {profile.navDrawerOpen ? <IconClose /> : <IconHamburger />}
          </button>
        )}
        <a
          href="/"
          data-testid="topnav-logo"
          style="display: flex; align-items: center; gap: 10px; text-decoration: none; color: #0f172a; min-width: 0;"
        >
          <span style="display: inline-flex; align-items: center; color: #1e3a8a; flex: 0 0 auto;">
            <IconLogo size={20} />
          </span>
          <span style="font-weight: 600; font-size: 14px; letter-spacing: -0.005em; white-space: nowrap; color: #0f172a;">
            Word Finder
          </span>
          {showBreadcrumb && (
            <>
              <span aria-hidden="true" style="color: #cbd5e1; margin: 0 4px;">/</span>
              <span data-testid="topnav-title" style="font-size: 13px; color: #64748b; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                {title}
              </span>
            </>
          )}
        </a>
      </div>

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
            {!compact && (
              <span style="font-size: 12px; color: #475569; font-weight: 500; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                {displayName || 'Set name'}
              </span>
            )}
          </button>
        )}

        {profile.avatarMenuOpen && (
          <AvatarMenu />
        )}
      </div>
    </header>
  );
});

export const AvatarMenu = component$(() => {
  const profile = useContext(ProfileCtx);
  const playerId = profile.playerId;
  const displayName = profile.profile?.displayName || '';

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
    <div
      role="menu"
      data-testid="avatar-menu"
      style="position: absolute; top: 44px; right: 0; min-width: 240px; background: rgba(255,255,255,0.78); border: 1px solid rgba(15,23,42,0.08); border-radius: 12px; box-shadow: 0 12px 30px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.04); padding: 8px; display: flex; flex-direction: column; gap: 2px; z-index: 100; backdrop-filter: blur(20px) saturate(160%); -webkit-backdrop-filter: blur(20px) saturate(160%);"
    >
      <div style="padding: 10px 10px 8px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid rgba(15,23,42,0.06); margin-bottom: 4px;">
        <Avatar playerId={playerId} displayName={displayName} size={36} />
        <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
          <span style="font-size: 13px; font-weight: 600; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            {displayName || 'Anonymous'}
          </span>
          <span style="font-size: 10px; color: #94a3b8; font-family: ui-monospace, SF Mono, Menlo, monospace;">
            {playerId.slice(0, 8)}…
          </span>
        </div>
      </div>
      <a
        href="/profile/"
        data-testid="avatar-menu-profile"
        onClick$={() => (profile.avatarMenuOpen = false)}
        style="padding: 8px 10px; border-radius: 8px; text-decoration: none; color: #0f172a; font-size: 13px; display: flex; align-items: center; gap: 10px;"
      >
        <span style="color: #64748b; display: inline-flex;"><IconUser size={16} /></span>
        View profile
      </a>
      <button
        type="button"
        data-testid="avatar-menu-rename"
        onClick$={renameInline}
        style="padding: 8px 10px; border-radius: 8px; background: transparent; border: 0; color: #0f172a; font-size: 13px; text-align: left; display: flex; align-items: center; gap: 10px; cursor: pointer;"
      >
        <span style="color: #64748b; display: inline-flex;"><IconEdit size={16} /></span>
        Rename
      </button>
    </div>
  );
});

export const TOP_NAV_HEIGHT = 56;
