import {
  $,
  component$,
  Slot,
  useBrowserVisibleTask$,
  useContext,
  useContextProvider,
  useStore,
} from '@builder.io/qwik';
import { ProfileCtx } from '../boggle/context';
import type { ProfileState } from '../boggle/context';
import { fetchProfile, updateDisplayName } from '../boggle/profile/api';
import { getOrCreatePlayerId, getDisplayName, setDisplayName } from '../boggle/multiplayer/storage';
import { TopNav, TOP_NAV_HEIGHT } from './TopNav';
import { LeftNav, LEFT_NAV_WIDTH_DESKTOP } from './LeftNav';

/**
 * Application shell — the layout chrome that wraps every route.
 *
 * Provides ProfileCtx so any descendant page (Play / Profile) can read or
 * mutate the player's profile. Hydrates the playerId from localStorage on
 * mount, fetches the profile from the PlayerProfile DO, and ensures the
 * server's display-name agrees with whatever's in localStorage so a fresh
 * device sees the same profile after typing a name once.
 */
export const ChromeShell = component$(() => {
  const profileState = useStore<ProfileState>({
    playerId: '',
    profile: null,
    loadStatus: 'idle',
    loadError: null,
    pendingMutation: false,
    avatarMenuOpen: false,
    navDrawerOpen: false,
    isCompactViewport: false,
  }, { deep: true });

  useContextProvider(ProfileCtx, profileState);

  useBrowserVisibleTask$(async () => {
    profileState.playerId = getOrCreatePlayerId();
    if (!profileState.playerId) return;
    profileState.loadStatus = 'loading';
    try {
      const fetched = await fetchProfile(profileState.playerId);
      profileState.profile = fetched;
      profileState.loadStatus = 'ready';
      // Sync displayName: localStorage (set during multiplayer join) wins
      // if the server hasn't recorded one yet.
      const local = getDisplayName();
      if (local && local !== fetched.displayName) {
        const updated = await updateDisplayName(profileState.playerId, local);
        profileState.profile = updated;
      } else if (fetched.displayName) {
        // Mirror server name back into localStorage so the multiplayer
        // join form pre-fills with the same value.
        setDisplayName(fetched.displayName);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      profileState.loadStatus = 'error';
      profileState.loadError = msg;
    }
  });

  // Add a global click handler to close avatar menu — done in TopNav itself
  // via useTask. Intentionally NOT here.

  const closeDrawer = $(() => { profileState.navDrawerOpen = false; });

  return (
    <div data-testid="chrome-shell" style="min-height: 100vh;">
      <TopNav />
      <LeftNav />
      {/* Mobile drawer backdrop — only rendered when the compact-viewport
          drawer is open. Click anywhere outside the sidebar to close. */}
      {profileState.isCompactViewport && profileState.navDrawerOpen && (
        <div
          data-testid="chrome-drawer-backdrop"
          onClick$={closeDrawer}
          aria-hidden="true"
          style={`position: fixed; top: ${TOP_NAV_HEIGHT}px; left: 0; right: 0; bottom: 0; background: rgba(15,23,42,0.35); z-index: 49; backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); animation: mp-fade-in 0.18s ease-out;`}
        />
      )}
      <main
        data-testid="chrome-main"
        style={`padding-top: ${TOP_NAV_HEIGHT}px; padding-left: var(--leftnav-width, ${LEFT_NAV_WIDTH_DESKTOP}px); transition: padding-left 0.18s ease-out; min-height: 100vh; box-sizing: border-box;`}
      >
        <Slot />
      </main>
      <ChromeViewportObserver />
    </div>
  );
});

/**
 * Tiny observer that mirrors the viewport's compact state into both
 * (a) ProfileCtx so other chrome components react to it, and (b) a CSS
 * custom property on the document root so the main padding stays in sync
 * without prop-drilling.
 */
export const ChromeViewportObserver = component$(() => {
  const profile = useContext(ProfileCtx);
  useBrowserVisibleTask$(({ cleanup }) => {
    const mq = window.matchMedia('(max-width: 720px)');
    const apply = () => {
      const compact = mq.matches;
      profile.isCompactViewport = compact;
      // On compact viewports the LeftNav slides off-screen entirely; main
      // content gets full width. On desktop main reserves space for the
      // persistent 200 px sidebar.
      document.documentElement.style.setProperty(
        '--leftnav-width',
        compact ? '0px' : `${LEFT_NAV_WIDTH_DESKTOP}px`,
      );
      // Compact viewports also auto-close the drawer if it was left open
      // by a prior session-stale state.
      if (!compact && profile.navDrawerOpen) profile.navDrawerOpen = false;
    };
    apply();
    mq.addEventListener('change', apply);
    cleanup(() => mq.removeEventListener('change', apply));
  });
  return null;
});

// Suppressed-unused-export marker so the optimizer doesn't tree-shake the
// avatar-menu close handler away (it's referenced by the parent shell via
// the dropdown button).
export const _ChromeShellHelper = $(() => 0);
