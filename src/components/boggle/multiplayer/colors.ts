// Derive a stable display color from a playerId so a given player looks the
// same in their row, in the recent-events feed, and in the end-game results
// bar — without the server needing to assign colors. Pure HSL hash.
//
// Saturation and lightness are constrained so all derived colors sit in the
// "readable on a light glass background" range, no matter the hash.

const SAT = 62;
const LIGHT = 48;

export const colorForPlayer = (playerId: string): string => {
  const hue = hash(playerId) % 360;
  return `hsl(${hue}, ${SAT}%, ${LIGHT}%)`;
};

// FNV-1a 32-bit. Fast, well-distributed; good enough for hue assignment.
const hash = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
};
