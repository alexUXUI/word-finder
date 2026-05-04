// PlayerProfile DO — one instance per playerId. Holds favorite boards,
// friends, and recent-players list. HTTP-only (no WebSockets), unlike
// GameRoom: profile mutations are infrequent and don't need real-time
// fan-out.
//
// Single storage key 'state' holds the entire ProfileState. DOs serialize
// requests so updates are atomic without explicit locking.

import { DurableObject } from 'cloudflare:workers';
import type {
  PlayerProfileState,
  FavoriteBoard,
  FriendEntry,
  RecentPlayer,
  UpdateProfileBody,
  AddFavoriteBoardBody,
  AddFriendBody,
  RecordRecentBody,
} from '../../src/components/boggle/profile/types';

interface Env {
  PROFILE: DurableObjectNamespace;
}

const STATE_KEY = 'state';
const MAX_FAVORITES = 200;
const MAX_RECENT = 30;
const MAX_FRIENDS = 500;

const cors = (init: ResponseInit = {}, body: BodyInit | null = null): Response => {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  headers.set('access-control-allow-headers', 'Content-Type');
  return new Response(body, { ...init, headers });
};
const json = (status: number, body: unknown): Response =>
  cors({ status }, JSON.stringify(body));

const newId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `b_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
};

const trim = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max) : s;

const emptyState = (playerId: string): PlayerProfileState => ({
  playerId,
  displayName: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  favoriteBoards: [],
  friends: [],
  recentPlayers: [],
});

export class PlayerProfile extends DurableObject<Env> {
  private state: PlayerProfileState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<PlayerProfileState>(STATE_KEY);
      if (stored) this.state = stored;
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return cors({ status: 204 });

    const url = new URL(request.url);
    // Trim leading "/profile/<id>" — the Worker routes by id; the DO sees
    // sub-paths starting at the next segment (e.g. "/favorite-board").
    const m = url.pathname.match(/^\/profile\/([^/]+)(.*)$/);
    if (!m) return json(404, { error: 'invalid profile path' });
    const playerId = decodeURIComponent(m[1]);
    const rest = m[2] || '/';

    if (!this.state) {
      this.state = emptyState(playerId);
      await this.persist();
    }

    // GET /profile/:id  — fetch (auto-creates on first hit)
    if (request.method === 'GET' && rest === '/') {
      return json(200, this.state);
    }
    // PATCH /profile/:id  — update displayName
    if (request.method === 'PATCH' && rest === '/') {
      const body = await this.readJson<UpdateProfileBody>(request);
      if (!body) return json(400, { error: 'invalid JSON body' });
      if (typeof body.displayName === 'string') {
        this.state.displayName = trim(body.displayName.trim(), 24) || this.state.displayName;
      }
      this.state.updatedAt = Date.now();
      await this.persist();
      return json(200, this.state);
    }

    // ─── favorite boards ───
    if (request.method === 'POST' && rest === '/favorite-board') {
      const body = await this.readJson<AddFavoriteBoardBody>(request);
      if (!body || typeof body.board !== 'string' || typeof body.size !== 'number') {
        return json(400, { error: 'board and size are required' });
      }
      // Idempotent on (board, source) — re-thumbing the same board doesn't dup.
      const source = body.source ?? 'batch';
      const existing = this.state.favoriteBoards.find(
        (f) => f.board === body.board && f.source === source,
      );
      if (existing) return json(200, { board: existing, alreadyExists: true });
      const fav: FavoriteBoard = {
        id: newId(),
        board: body.board,
        size: body.size,
        score: typeof body.score === 'number' ? body.score : 0,
        pipelineId: body.pipelineId ?? null,
        source,
        notes: body.notes ?? null,
        savedAt: Date.now(),
      };
      this.state.favoriteBoards = [fav, ...this.state.favoriteBoards].slice(0, MAX_FAVORITES);
      this.state.updatedAt = Date.now();
      await this.persist();
      return json(201, { board: fav, alreadyExists: false });
    }
    if (request.method === 'DELETE' && rest.startsWith('/favorite-board/')) {
      const boardId = rest.slice('/favorite-board/'.length);
      this.state.favoriteBoards = this.state.favoriteBoards.filter((f) => f.id !== boardId);
      this.state.updatedAt = Date.now();
      await this.persist();
      return json(200, { ok: true });
    }

    // ─── friends ───
    if (request.method === 'POST' && rest.startsWith('/friend/')) {
      const otherId = rest.slice('/friend/'.length);
      if (!otherId || otherId === playerId) return json(400, { error: 'invalid friend id' });
      const body = (await this.readJson<AddFriendBody>(request)) ?? { displayName: 'anonymous' };
      const existing = this.state.friends.find((f) => f.playerId === otherId);
      if (existing) return json(200, { friend: existing, alreadyExists: true });
      const friend: FriendEntry = {
        playerId: otherId,
        displayName: trim((body.displayName || 'anonymous').trim(), 24),
        addedAt: Date.now(),
      };
      this.state.friends = [friend, ...this.state.friends].slice(0, MAX_FRIENDS);
      this.state.updatedAt = Date.now();
      await this.persist();
      return json(201, { friend, alreadyExists: false });
    }
    if (request.method === 'DELETE' && rest.startsWith('/friend/')) {
      const otherId = rest.slice('/friend/'.length);
      this.state.friends = this.state.friends.filter((f) => f.playerId !== otherId);
      this.state.updatedAt = Date.now();
      await this.persist();
      return json(200, { ok: true });
    }

    // ─── recent players (auto-tracked from multiplayer game ends) ───
    if (request.method === 'POST' && rest.startsWith('/recent/')) {
      const otherId = rest.slice('/recent/'.length);
      if (!otherId || otherId === playerId) return json(400, { error: 'invalid recent id' });
      const body = (await this.readJson<RecordRecentBody>(request)) ?? { displayName: 'anonymous', gameName: 'unknown' };
      const next: RecentPlayer = {
        playerId: otherId,
        displayName: trim((body.displayName || 'anonymous').trim(), 24),
        lastGame: trim((body.gameName || 'unknown').trim(), 48),
        lastSeenAt: Date.now(),
      };
      this.state.recentPlayers = [
        next,
        ...this.state.recentPlayers.filter((r) => r.playerId !== otherId),
      ].slice(0, MAX_RECENT);
      this.state.updatedAt = Date.now();
      await this.persist();
      return json(200, { recent: next });
    }

    return json(404, { error: `no route: ${request.method} ${rest}` });
  }

  private async persist(): Promise<void> {
    if (this.state) await this.ctx.storage.put(STATE_KEY, this.state);
  }

  private async readJson<T>(request: Request): Promise<T | null> {
    try { return (await request.json()) as T; } catch { return null; }
  }
}
