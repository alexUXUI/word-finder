// Derived avatar — colored circle with initial letter, generated from
// playerId + displayName. Pure & deterministic so the same player looks
// the same everywhere they appear (their own header, friend rows,
// multiplayer player list).
//
// Reuses the colorForPlayer hash from multiplayer/colors.ts so a player's
// row color in the multiplayer panel and their avatar circle on the
// dashboard share the same identity color.

import { colorForPlayer } from '../multiplayer/colors';

export interface AvatarSpec {
  bg: string;       // CSS color
  fg: string;       // text color (always white for v1)
  initial: string;  // single uppercase letter
}

export const avatarFor = (playerId: string, displayName: string): AvatarSpec => {
  const trimmed = (displayName || '').trim();
  const initial = (trimmed[0] || playerId[0] || '?').toUpperCase();
  return {
    bg: colorForPlayer(playerId || 'unknown'),
    fg: '#ffffff',
    initial,
  };
};
