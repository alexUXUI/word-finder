// Browser-side fetch wrapper for the PlayerProfile DO.
//
// Same dev/prod URL pattern as the multiplayer client: same-origin
// `/api/profile/...` in production (Pages Function proxy), localhost
// worker on :8788 in dev. Override via PUBLIC_PROFILE_HTTP_URL or
// VITE_PROFILE_HTTP_URL env vars.

import type {
  PlayerProfileState,
  AddFavoriteBoardBody,
  FavoriteBoard,
  AddFriendBody,
  FriendEntry,
  RecordRecentBody,
  RecentPlayer,
} from './types';

export const buildProfileBaseUrl = (): string => {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const override = env.PUBLIC_PROFILE_HTTP_URL ?? env.VITE_PROFILE_HTTP_URL;
  if (override) return override.replace(/\/+$/, '');
  if (typeof window === 'undefined') return '';
  const host = window.location.host;
  const isLocalDev = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$)/.test(host);
  if (isLocalDev) return 'http://localhost:8788';
  const proto = window.location.protocol === 'https:' ? 'https:' : 'http:';
  return `${proto}//${host}/api`;
};

const profileUrl = (playerId: string, sub = ''): string => {
  const base = buildProfileBaseUrl();
  return `${base}/profile/${encodeURIComponent(playerId)}${sub}`;
};

const handle = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch { /* noop */ }
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
};

export const fetchProfile = (playerId: string): Promise<PlayerProfileState> =>
  fetch(profileUrl(playerId)).then((r) => handle<PlayerProfileState>(r));

export const updateDisplayName = (
  playerId: string,
  displayName: string,
): Promise<PlayerProfileState> =>
  fetch(profileUrl(playerId), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName }),
  }).then((r) => handle<PlayerProfileState>(r));

export const addFavoriteBoard = (
  playerId: string,
  body: AddFavoriteBoardBody,
): Promise<{ board: FavoriteBoard; alreadyExists: boolean }> =>
  fetch(profileUrl(playerId, '/favorite-board'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => handle<{ board: FavoriteBoard; alreadyExists: boolean }>(r));

export const removeFavoriteBoard = (
  playerId: string,
  boardId: string,
): Promise<{ ok: true }> =>
  fetch(profileUrl(playerId, `/favorite-board/${encodeURIComponent(boardId)}`), {
    method: 'DELETE',
  }).then((r) => handle<{ ok: true }>(r));

export const addFriend = (
  playerId: string,
  otherId: string,
  body: AddFriendBody,
): Promise<{ friend: FriendEntry; alreadyExists: boolean }> =>
  fetch(profileUrl(playerId, `/friend/${encodeURIComponent(otherId)}`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => handle<{ friend: FriendEntry; alreadyExists: boolean }>(r));

export const removeFriend = (
  playerId: string,
  otherId: string,
): Promise<{ ok: true }> =>
  fetch(profileUrl(playerId, `/friend/${encodeURIComponent(otherId)}`), {
    method: 'DELETE',
  }).then((r) => handle<{ ok: true }>(r));

export const recordRecentPlayer = (
  playerId: string,
  otherId: string,
  body: RecordRecentBody,
): Promise<{ recent: RecentPlayer }> =>
  fetch(profileUrl(playerId, `/recent/${encodeURIComponent(otherId)}`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => handle<{ recent: RecentPlayer }>(r));
