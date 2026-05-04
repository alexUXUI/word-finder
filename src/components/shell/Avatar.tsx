import { component$ } from '@builder.io/qwik';
import { avatarFor } from '../boggle/profile/identicon';

export interface AvatarProps {
  playerId: string;
  displayName: string;
  size?: number;
  /** When true, renders a small connected/online dot in the corner. */
  showOnlineDot?: boolean;
}

/**
 * Derived circular avatar — colored bg from the playerId hash + uppercase
 * initial from the display name. Same identity color as the multiplayer
 * player rows so a person looks the same everywhere.
 */
export const Avatar = component$<AvatarProps>(({ playerId, displayName, size = 32, showOnlineDot = false }) => {
  const { bg, fg, initial } = avatarFor(playerId, displayName);
  const fontSize = Math.max(11, Math.round(size * 0.46));
  return (
    <span
      data-testid="avatar"
      data-player-id={playerId}
      style={`position: relative; display: inline-flex; align-items: center; justify-content: center; width: ${size}px; height: ${size}px; border-radius: 999px; background: ${bg}; color: ${fg}; font-weight: 700; font-size: ${fontSize}px; line-height: 1; flex: 0 0 auto; box-shadow: 0 1px 2px rgba(15,23,42,0.12), inset 0 -1px 1px rgba(0,0,0,0.06);`}
      aria-label={`${displayName || 'Anonymous player'} avatar`}
    >
      {initial}
      {showOnlineDot && (
        <span
          aria-hidden="true"
          style={`position: absolute; bottom: -1px; right: -1px; width: ${Math.max(8, size * 0.28)}px; height: ${Math.max(8, size * 0.28)}px; background: #22c55e; border: 2px solid #fff; border-radius: 999px;`}
        />
      )}
    </span>
  );
});
