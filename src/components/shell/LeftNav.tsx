import { component$, useContext } from '@builder.io/qwik';
import { useLocation } from '@builder.io/qwik-city';
import { ProfileCtx } from '../boggle/context';
import { IconBolt, IconGrid, IconPlay, IconStar, IconUser } from './icons';
import type { Component } from '@builder.io/qwik';

interface NavItem {
  href: string;
  label: string;
  Icon: Component<{ size?: number; title?: string }>;
  testId: string;
  /** When set, this item is "active" if the current pathname is `/` AND
   *  the URL has `?panel=<openPanel>`. Used for panel-opener links. */
  panel?: 'multiplayer' | 'builder' | 'stats';
}

export const ITEMS: NavItem[] = [
  { href: '/',                     label: 'Play',          Icon: IconPlay, testId: 'leftnav-play' },
  { href: '/?panel=multiplayer',   label: 'Multiplayer',   Icon: IconBolt, testId: 'leftnav-multiplayer', panel: 'multiplayer' },
  { href: '/?panel=builder',       label: 'Board Builder', Icon: IconGrid, testId: 'leftnav-builder',     panel: 'builder' },
  { href: '/?panel=stats',         label: 'Batch Stats',   Icon: IconStar, testId: 'leftnav-stats',       panel: 'stats' },
  { href: '/profile/',             label: 'Profile',       Icon: IconUser, testId: 'leftnav-profile' },
];

/**
 * Vertical sidebar — frosted glass shell.
 *
 *  - Desktop (>720 px): persistent 200 px sidebar.
 *  - Mobile  (≤720 px): off-screen by default; slides in as a 240 px
 *    drawer when the topnav's hamburger toggles navDrawerOpen.
 *
 * Active item: subtle white-frosted tint + 3 px amber inset bar on the
 * left edge. No emojis — single-color SVG line icons (see ./icons.tsx).
 */
export const LeftNav = component$(() => {
  const loc = useLocation();
  const profile = useContext(ProfileCtx);

  const compact = profile.isCompactViewport;
  const drawerOpen = profile.navDrawerOpen;

  const width = compact ? 240 : LEFT_NAV_WIDTH_DESKTOP;
  const translateX = compact && !drawerOpen ? '-100%' : '0';
  const elevation = compact && drawerOpen
    ? 'box-shadow: 4px 0 28px rgba(15,23,42,0.18);'
    : '';

  return (
    <nav
      data-testid="leftnav"
      data-compact={compact ? 'true' : 'false'}
      data-drawer-open={drawerOpen ? 'true' : 'false'}
      aria-label="Primary"
      style={`position: fixed; top: 56px; left: 0; bottom: 0; width: ${width}px; z-index: 50; background: rgba(255,255,255,0.42); backdrop-filter: blur(14px) saturate(140%); -webkit-backdrop-filter: blur(14px) saturate(140%); border-right: 1px solid rgba(15,23,42,0.06); padding: 14px 10px; display: flex; flex-direction: column; gap: 4px; transform: translateX(${translateX}); transition: transform 0.22s ease-out; ${elevation}`}
    >
      {ITEMS.map((item) => {
        const onHome = loc.url.pathname === '/' || loc.url.pathname === '';
        const currentPanel = loc.url.searchParams.get('panel');
        let active = false;
        if (item.panel) {
          // Panel-opener: active when on / AND ?panel matches.
          active = onHome && currentPanel === item.panel;
        } else if (item.href === '/') {
          // "Play" is active on / with no panel query.
          active = onHome && !currentPanel;
        } else {
          active = loc.url.pathname.startsWith(item.href);
        }
        const Icon = item.Icon;
        return (
          <a
            key={item.href}
            href={item.href}
            data-testid={item.testId}
            data-active={active ? 'true' : 'false'}
            title={item.label}
            onClick$={() => { if (compact) profile.navDrawerOpen = false; }}
            style={`position: relative; display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 8px; color: ${active ? '#0f172a' : '#475569'}; background: ${active ? 'rgba(255,255,255,0.7)' : 'transparent'}; text-decoration: none; font-size: 13.5px; font-weight: ${active ? 600 : 500}; transition: background 0.12s, color 0.12s; white-space: nowrap; overflow: hidden; ${active ? 'box-shadow: inset 3px 0 0 #f59e0b, 0 1px 2px rgba(15,23,42,0.04);' : ''}`}
          >
            <span style={`color: ${active ? '#0f172a' : '#94a3b8'}; display: inline-flex; flex: 0 0 auto; transition: color 0.12s;`}>
              <Icon size={16} />
            </span>
            <span>{item.label}</span>
          </a>
        );
      })}

      <div style="flex: 1;"></div>

      {compact && (
        <div style="font-size: 10px; color: #cbd5e1; text-align: center; padding: 6px 0; border-top: 1px solid rgba(15,23,42,0.06); letter-spacing: 0.04em;">
          tap outside to close
        </div>
      )}
    </nav>
  );
});

export const LEFT_NAV_WIDTH_DESKTOP = 200;
export const LEFT_NAV_WIDTH_COMPACT = 0;
