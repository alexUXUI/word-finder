// Persistent identity + recent-games memory for the multiplayer feature.
//
// No accounts: a UUID in localStorage IS the player identity. If the user
// clears storage they get a new identity (and lose the ability to rejoin a
// mid-game with their words). Acceptable for a casual word game.
//
// All functions are guarded against SSR — they short-circuit to safe
// defaults when localStorage is unavailable, so they're safe to call from
// any Qwik visible task.

const PLAYER_ID_KEY = 'word-finder.player-id';
const DISPLAY_NAME_KEY = 'word-finder.display-name';
const RECENT_GAMES_KEY = 'word-finder.recent-games';
const RECENT_GAMES_MAX = 5;

const ls = (): Storage | null => {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
};

export const getOrCreatePlayerId = (): string => {
  const store = ls();
  if (!store) return ''; // SSR — caller must re-derive after hydration
  let id = store.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `p_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    store.setItem(PLAYER_ID_KEY, id);
  }
  return id;
};

export const getDisplayName = (): string => {
  const store = ls();
  return (store && store.getItem(DISPLAY_NAME_KEY)) || '';
};

export const setDisplayName = (name: string): void => {
  const store = ls();
  if (!store) return;
  store.setItem(DISPLAY_NAME_KEY, name);
};

export const recordRecentGame = (gameName: string): void => {
  const store = ls();
  if (!store || !gameName) return;
  const list = readRecentGames();
  const lower = gameName.toLowerCase();
  const next = [lower, ...list.filter((g) => g !== lower)].slice(0, RECENT_GAMES_MAX);
  store.setItem(RECENT_GAMES_KEY, JSON.stringify(next));
};

export const readRecentGames = (): string[] => {
  const store = ls();
  if (!store) return [];
  try {
    const raw = store.getItem(RECENT_GAMES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
};
