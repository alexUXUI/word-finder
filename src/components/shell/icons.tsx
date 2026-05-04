import { component$ } from '@builder.io/qwik';

/**
 * Tiny inline-SVG icon set — single-color line icons that pick up
 * `currentColor`. No icon-library dependency. Uniform 1.5 px stroke,
 * 24×24 viewBox so they read crisply at any rendered size.
 *
 * Used by the dashboard chrome (TopNav / LeftNav / ProfilePage / Avatar
 * menu) so the design stays minimal and emoji-free.
 */

interface IconProps {
  /** Rendered size in CSS pixels. Default 18. */
  size?: number;
  /** Optional title for accessibility — when omitted the icon is purely
   *  decorative and gets aria-hidden. */
  title?: string;
}

export const base = (props: IconProps) => ({
  width: props.size ?? 18,
  height: props.size ?? 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.5,
  'stroke-linecap': 'round' as const,
  'stroke-linejoin': 'round' as const,
  ...(props.title ? { role: 'img', 'aria-label': props.title } : { 'aria-hidden': 'true' }),
});

export const IconPlay = component$<IconProps>((p) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </svg>
));

export const IconUser = component$<IconProps>((p) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5" />
  </svg>
));

export const IconEdit = component$<IconProps>((p) => (
  <svg {...base(p)}>
    <path d="M14.5 5l4.5 4.5-10 10H4.5v-4.5z" />
    <path d="M13 6.5l4.5 4.5" />
  </svg>
));

export const IconClose = component$<IconProps>((p) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
));

export const IconHamburger = component$<IconProps>((p) => (
  <svg {...base(p)}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
));

export const IconCheck = component$<IconProps>((p) => (
  <svg {...base(p)}>
    <path d="M5 12l4.5 4.5L19 7" />
  </svg>
));

export const IconStar = component$<IconProps>((p) => (
  <svg {...base(p)}>
    <path d="M12 4l2.6 5.4 6 .9-4.3 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.4 10.3l6-.9z" />
  </svg>
));

export const IconUsers = component$<IconProps>((p) => (
  <svg {...base(p)}>
    <circle cx="9" cy="9" r="3" />
    <path d="M3 19c.9-3 3.4-4.5 6-4.5s5.1 1.5 6 4.5" />
    <circle cx="17.5" cy="8" r="2.4" />
    <path d="M15 14.5c1-.4 2-.6 2.8-.6 2 0 3.7 1 4.5 3" />
  </svg>
));

export const IconHome = component$<IconProps>((p) => (
  <svg {...base(p)}>
    <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />
  </svg>
));

export const IconSparkle = component$<IconProps>((p) => (
  // Four-point compass star — used for AI / reasoning surfaces.
  <svg {...base(p)}>
    <path d="M12 4v6M12 14v6M4 12h6M14 12h6" />
    <path d="M12 4l1.5 6.5L20 12l-6.5 1.5L12 20l-1.5-6.5L4 12l6.5-1.5z" stroke-width="1" />
  </svg>
));

export const IconBolt = component$<IconProps>((p) => (
  // Lightning — used for the Multiplayer nav link to evoke real-time.
  <svg {...base(p)}>
    <path d="M13 3L5 13.5h6l-1 7.5 8-10.5h-6z" />
  </svg>
));

export const IconGrid = component$<IconProps>((p) => (
  // 2×2 grid — used for Board Builder.
  <svg {...base(p)}>
    <rect x="4"  y="4"  width="7" height="7" rx="1.5" />
    <rect x="13" y="4"  width="7" height="7" rx="1.5" />
    <rect x="4"  y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </svg>
));

export const IconLogo = component$<IconProps>((p) => (
  // Minimal abstract wordmark — two stacked rectangles suggesting an
  // open book without using the 📖 emoji.
  <svg {...base(p)} viewBox="0 0 24 24">
    <path d="M4 6h7v13H4z" />
    <path d="M13 6h7v13h-7z" />
    <path d="M11.5 6v13M11.5 6c-1-.5-3-1-7 0M11.5 6c1-.5 3-1 7 0" />
  </svg>
));
