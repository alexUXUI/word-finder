import { component$, useContext } from '@builder.io/qwik';
import { useLocation } from '@builder.io/qwik-city';
import { ProfileCtx } from '../boggle/context';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  testId: string;
}

export const ITEMS: NavItem[] = [
  { href: '/',         label: 'Play',    icon: '🎯', testId: 'leftnav-play' },
  { href: '/profile/', label: 'Profile', icon: '👤', testId: 'leftnav-profile' },
];

/**
 * Vertical sidebar — the fixed-position chrome on the left edge.
 *
 * Two layout modes, driven by ProfileCtx.isCompactViewport (set by
 * ChromeViewportObserver on resize):
 *
 *  - Desktop (>720 px): always visible at LEFT_NAV_WIDTH_DESKTOP.
 *    Permanent navigation. Main content padded-left to make room.
 *  - Mobile (≤720 px): off-screen by default (translateX(-100%));
 *    slides in as a full-height drawer when navDrawerOpen flips true
 *    (the TopNav's hamburger toggles it). Main content takes full
 *    viewport width — `--leftnav-width` is set to 0 on compact.
 *
 * On mobile the drawer is always rendered with full labels (not
 * icon-only) so the touch targets are large and comfortable.
 */
export const LeftNav = component$(() => {
  const loc = useLocation();
  const profile = useContext(ProfileCtx);

  const compact = profile.isCompactViewport;
  const drawerOpen = profile.navDrawerOpen;

  // Geometry
  const width = compact ? 240 : LEFT_NAV_WIDTH_DESKTOP;
  // Compact mode: slide off-screen unless the drawer is open
  const translateX = compact && !drawerOpen ? '-100%' : '0';
  const elevation = compact && drawerOpen
    ? 'box-shadow: 4px 0 24px rgba(15,23,42,0.18);'
    : '';

  return (
    <nav
      data-testid="leftnav"
      data-compact={compact ? 'true' : 'false'}
      data-drawer-open={drawerOpen ? 'true' : 'false'}
      aria-label="Primary"
      style={`position: fixed; top: 56px; left: 0; bottom: 0; width: ${width}px; z-index: 50; background: #ffffff; border-right: 1px solid #e2e8f0; padding: 16px 10px; display: flex; flex-direction: column; gap: 4px; transform: translateX(${translateX}); transition: transform 0.22s ease-out, width 0.18s ease-out; ${elevation}`}
    >
      {ITEMS.map((item) => {
        const active =
          item.href === '/'
            ? loc.url.pathname === '/' || loc.url.pathname === ''
            : loc.url.pathname.startsWith(item.href);
        return (
          <a
            key={item.href}
            href={item.href}
            data-testid={item.testId}
            data-active={active ? 'true' : 'false'}
            title={item.label}
            onClick$={() => { if (compact) profile.navDrawerOpen = false; }}
            style={`display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 8px; color: ${active ? '#0f172a' : '#475569'}; background: ${active ? 'rgba(245,158,11,0.12)' : 'transparent'}; text-decoration: none; font-size: 14px; font-weight: ${active ? 600 : 500}; transition: background 0.12s; white-space: nowrap; overflow: hidden; ${active ? `box-shadow: inset 3px 0 0 #f59e0b;` : ''}`}
          >
            <span style="font-size: 18px; line-height: 1; flex: 0 0 auto;">{item.icon}</span>
            <span>{item.label}</span>
          </a>
        );
      })}
      {/* Footer area in the drawer — could host extra actions later */}
      <div style="flex: 1;"></div>
      {compact && (
        <div style="font-size: 10px; color: #cbd5e1; text-align: center; padding: 6px 0; border-top: 1px solid #f1f5f9;">
          tap outside to close
        </div>
      )}
    </nav>
  );
});

export const LEFT_NAV_WIDTH_DESKTOP = 200;
export const LEFT_NAV_WIDTH_COMPACT = 0;
