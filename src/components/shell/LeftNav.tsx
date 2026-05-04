import { component$, useSignal, useTask$ } from '@builder.io/qwik';
import { useLocation } from '@builder.io/qwik-city';

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
 * Vertical sidebar — the fixed-position chrome on the left edge of every
 * route. Highlights the currently-active route. Collapses to icon-only on
 * narrow viewports.
 */
export const LeftNav = component$(() => {
  const loc = useLocation();
  const isCompact = useSignal(false);

  // Track viewport width so the sidebar collapses on mobile.
  useTask$(({ cleanup }) => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 720px)');
    const apply = () => (isCompact.value = mq.matches);
    apply();
    mq.addEventListener('change', apply);
    cleanup(() => mq.removeEventListener('change', apply));
  });

  const width = isCompact.value ? 56 : 200;

  return (
    <nav
      data-testid="leftnav"
      data-compact={isCompact.value ? 'true' : 'false'}
      aria-label="Primary"
      style={`position: fixed; top: 56px; left: 0; bottom: 0; width: ${width}px; z-index: 50; background: rgba(255,255,255,0.85); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border-right: 1px solid #e2e8f0; padding: 12px 8px; display: flex; flex-direction: column; gap: 4px; transition: width 0.18s ease-out;`}
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
            style={`display: flex; align-items: center; gap: 10px; padding: ${isCompact.value ? '10px 14px' : '10px 12px'}; border-radius: 8px; color: ${active ? '#0f172a' : '#475569'}; background: ${active ? 'rgba(245,158,11,0.12)' : 'transparent'}; text-decoration: none; font-size: 13px; font-weight: ${active ? 600 : 500}; transition: background 0.12s; white-space: nowrap; overflow: hidden; ${active ? `box-shadow: inset 3px 0 0 #f59e0b;` : ''}`}
          >
            <span style="font-size: 16px; line-height: 1;">{item.icon}</span>
            {!isCompact.value && <span>{item.label}</span>}
          </a>
        );
      })}
    </nav>
  );
});

export const LEFT_NAV_WIDTH_DESKTOP = 200;
export const LEFT_NAV_WIDTH_COMPACT = 56;
