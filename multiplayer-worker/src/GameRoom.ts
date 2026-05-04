// GameRoom — one Durable Object instance per game name. Owns the canonical
// state for a single multiplayer session, validates every player action
// server-side, and broadcasts state changes to all connected sockets.
//
// Uses the WebSocket Hibernation API (acceptWebSocket + webSocketMessage +
// webSocketClose) so the DO can unload between bursts of activity without
// dropping connections. Per-socket state (the playerId) is preserved across
// hibernation via serializeAttachment.

import { DurableObject } from 'cloudflare:workers';
import {
  parseClientFrame,
  encodeFrame,
  decodeFrame,
  type ClientFrame,
  type ServerFrame,
  type GameState,
  type PlayerState,
  type ServerErrorCode,
} from '../../src/components/boggle/multiplayer/protocol';
import { isValidBoggleWord } from '../../src/components/boggle/multiplayer/path-validation';
import { computeResults } from '../../src/components/boggle/multiplayer/scoring';

interface Env {
  GAME_ROOM: DurableObjectNamespace;
}

interface SocketAttachment {
  playerId: string;
}

const STATE_KEY = 'state';
const DICT_KEY = 'dict-v1';
const DICT_URL = 'https://boggle.pages.dev/engmix.txt';
const DEFAULT_BOARD_SIZE = 5;
const DEFAULT_MIN_LEN = 3;
const ENGLISH_FREQ: Readonly<Record<string, number>> = {
  a: 8.2, b: 1.5, c: 2.8, d: 4.3, e: 12.7, f: 2.2, g: 2.0, h: 6.1,
  i: 7.0, j: 0.15, k: 0.77, l: 4.0, m: 2.4, n: 6.7, o: 7.5, p: 1.9,
  q: 0.095, r: 6.0, s: 6.3, t: 9.1, u: 2.8, v: 0.98, w: 2.4, x: 0.15,
  y: 2.0, z: 0.074,
};

const sampleBoard = (size: number): string => {
  const entries = Object.entries(ENGLISH_FREQ);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let out = '';
  for (let i = 0; i < size * size; i++) {
    let r = Math.random() * total;
    for (const [letter, w] of entries) {
      r -= w;
      if (r <= 0) {
        out += letter;
        break;
      }
    }
  }
  return out;
};

const emptyState = (gameName: string): GameState => ({
  name: gameName.toLowerCase(),
  displayName: gameName,
  state: 'lobby',
  hostPlayerId: null,
  board: '',
  boardSize: DEFAULT_BOARD_SIZE,
  language: 'English',
  minCharLength: DEFAULT_MIN_LEN,
  pipelineId: null,
  pipelineFinalScore: null,
  startedAt: null,
  endedAt: null,
  maxDurationMs: null,
  players: {},
});

export class GameRoom extends DurableObject<Env> {
  private gameState: GameState | null = null;
  private dict: Set<string> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Synchronous-ish hydrate via blockConcurrencyWhile so the first request
    // sees a populated gameState.
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<GameState>(STATE_KEY);
      if (stored) this.gameState = stored;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get('Upgrade');
    if (upgrade !== 'websocket') {
      return new Response('expected WebSocket Upgrade', { status: 426 });
    }
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/games\/([^/]+)\/?$/);
    const gameName = match ? decodeURIComponent(match[1]) : 'unknown';
    if (!this.gameState) {
      this.gameState = emptyState(gameName);
      await this.persist();
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Hibernation: the runtime delivers messages to webSocketMessage even
    // while the DO is unloaded. No need to call accept() ourselves.
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === 'string'
      ? message
      : new TextDecoder().decode(message);
    const decoded = decodeFrame(text);
    const parsed = parseClientFrame(decoded);
    if (!parsed.ok) {
      this.sendErrorTo(ws, 'bad_frame', parsed.reason);
      return;
    }
    const frame = parsed.frame;
    const attach = ws.deserializeAttachment() as SocketAttachment | null;

    // The first frame from a socket MUST be `join`; anything else gets
    // rejected with not_joined.
    if (!attach && frame.type !== 'join') {
      this.sendErrorTo(ws, 'not_joined', 'send a join frame first');
      return;
    }

    switch (frame.type) {
      case 'join':
        await this.handleJoin(ws, frame);
        return;
      case 'start':
        await this.handleStart(ws, attach!);
        return;
      case 'found':
        await this.handleFound(ws, attach!, frame);
        return;
      case 'ready':
        await this.handleReady(ws, attach!, frame);
        return;
      case 'leave':
        // Treat as a clean close; webSocketClose will run the bookkeeping.
        ws.close(1000, 'leave');
        return;
      case 'heartbeat':
        if (attach) this.touchPlayer(attach.playerId);
        return;
    }
  }

  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    const attach = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attach || !this.gameState) return;
    const p = this.gameState.players[attach.playerId];
    if (p) {
      p.connected = false;
      p.lastSeenAt = Date.now();
      // Disconnected players don't gate end-game consensus — re-evaluate.
      await this.persist();
      this.broadcast({ type: 'player_left', playerId: attach.playerId });
      await this.maybeEndGame();
    }
  }

  // ───────────────────────────── handlers ─────────────────────────────

  private async handleJoin(
    ws: WebSocket,
    frame: Extract<ClientFrame, { type: 'join' }>,
  ): Promise<void> {
    if (!this.gameState) this.gameState = emptyState(frame.gameName);
    const now = Date.now();
    const existing = this.gameState.players[frame.playerId];
    if (existing) {
      // Reconnect: same playerId rejoins. Keep foundWords / readyToEnd.
      existing.connected = true;
      existing.lastSeenAt = now;
      existing.displayName = frame.displayName || existing.displayName;
    } else {
      // Optional: reject duplicate display names. Phase 1 just disambiguates
      // by playerId — name collisions are visual only.
      const player: PlayerState = {
        id: frame.playerId,
        displayName: frame.displayName || 'anonymous',
        joinedAt: now,
        foundWords: [],
        readyToEnd: false,
        lastSeenAt: now,
        connected: true,
      };
      this.gameState.players[frame.playerId] = player;
      if (!this.gameState.hostPlayerId) {
        this.gameState.hostPlayerId = frame.playerId;
      }
    }
    ws.serializeAttachment({ playerId: frame.playerId } satisfies SocketAttachment);
    await this.persist();
    // Send full state to the joiner; broadcast player_joined to the rest.
    this.sendTo(ws, { type: 'state', state: this.gameState });
    this.broadcast(
      { type: 'player_joined', player: this.gameState.players[frame.playerId] },
      ws,
    );
  }

  private async handleStart(ws: WebSocket, attach: SocketAttachment): Promise<void> {
    if (!this.gameState) return;
    if (this.gameState.state !== 'lobby') {
      this.sendErrorTo(ws, 'not_in_lobby', `state is ${this.gameState.state}`);
      return;
    }
    this.touchPlayer(attach.playerId);
    this.gameState.state = 'playing';
    this.gameState.board = sampleBoard(this.gameState.boardSize);
    this.gameState.startedAt = Date.now();
    await this.persist();
    this.broadcast({
      type: 'game_started',
      board: this.gameState.board,
      startedAt: this.gameState.startedAt,
      pipelineId: this.gameState.pipelineId,
    });
    this.broadcast({ type: 'state', state: this.gameState });
  }

  private async handleFound(
    ws: WebSocket,
    attach: SocketAttachment,
    frame: Extract<ClientFrame, { type: 'found' }>,
  ): Promise<void> {
    if (!this.gameState) return;
    if (this.gameState.state !== 'playing') {
      this.sendErrorTo(ws, 'not_playing', `state is ${this.gameState.state}`);
      return;
    }
    const word = frame.word.trim().toLowerCase();
    const player = this.gameState.players[attach.playerId];
    if (!player) {
      this.sendErrorTo(ws, 'not_joined', 'player not in room');
      return;
    }
    if (word.length < this.gameState.minCharLength) {
      this.sendErrorTo(ws, 'too_short', `min ${this.gameState.minCharLength}`);
      return;
    }
    if (player.foundWords.includes(word)) {
      this.sendErrorTo(ws, 'already_found', word);
      return;
    }
    if (!isValidBoggleWord(word, this.gameState.board, this.gameState.boardSize)) {
      this.sendErrorTo(ws, 'invalid_path', word);
      return;
    }
    const dict = await this.loadDictionary();
    if (dict && !dict.has(word)) {
      this.sendErrorTo(ws, 'not_a_word', word);
      return;
    }
    player.foundWords.push(word);
    this.touchPlayer(attach.playerId);
    await this.persist();
    this.broadcast({
      type: 'player_found',
      playerId: attach.playerId,
      word,
      totalCount: player.foundWords.length,
    });
  }

  private async handleReady(
    ws: WebSocket,
    attach: SocketAttachment,
    frame: Extract<ClientFrame, { type: 'ready' }>,
  ): Promise<void> {
    if (!this.gameState) return;
    if (this.gameState.state !== 'playing') {
      // Silently ignore per §5; no error frame.
      return;
    }
    const player = this.gameState.players[attach.playerId];
    if (!player) return;
    player.readyToEnd = frame.ready;
    this.touchPlayer(attach.playerId);
    await this.persist();
    this.broadcast({
      type: 'player_ready',
      playerId: attach.playerId,
      ready: frame.ready,
    });
    await this.maybeEndGame();
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private async maybeEndGame(): Promise<void> {
    if (!this.gameState || this.gameState.state !== 'playing') return;
    const connected = Object.values(this.gameState.players).filter((p) => p.connected);
    if (connected.length === 0) return;
    const allReady = connected.every((p) => p.readyToEnd);
    if (!allReady) return;
    this.gameState.state = 'ended';
    this.gameState.endedAt = Date.now();
    await this.persist();
    const results = computeResults(this.gameState.players);
    this.broadcast({ type: 'game_ended', results, endedAt: this.gameState.endedAt });
    this.broadcast({ type: 'state', state: this.gameState });
  }

  private touchPlayer(playerId: string): void {
    if (!this.gameState) return;
    const p = this.gameState.players[playerId];
    if (p) {
      p.connected = true;
      p.lastSeenAt = Date.now();
    }
  }

  private sendTo(ws: WebSocket, frame: ServerFrame): void {
    try {
      ws.send(encodeFrame(frame));
    } catch {
      // Socket may have been closed mid-broadcast — ignore.
    }
  }

  private sendErrorTo(ws: WebSocket, code: ServerErrorCode, message: string): void {
    this.sendTo(ws, { type: 'error', code, message });
  }

  private broadcast(frame: ServerFrame, except?: WebSocket): void {
    const payload = encodeFrame(frame);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(payload); } catch { /* ignore */ }
    }
  }

  private async persist(): Promise<void> {
    if (this.gameState) await this.ctx.storage.put(STATE_KEY, this.gameState);
  }

  private async loadDictionary(): Promise<Set<string> | null> {
    if (this.dict) return this.dict;
    const cached = await this.ctx.storage.get<string[]>(DICT_KEY);
    if (cached && cached.length > 0) {
      this.dict = new Set(cached);
      return this.dict;
    }
    try {
      const res = await fetch(DICT_URL);
      if (!res.ok) return null;
      const text = await res.text();
      const words = text.split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter(Boolean);
      this.dict = new Set(words);
      // Cache to DO storage so subsequent cold starts skip the fetch.
      await this.ctx.storage.put(DICT_KEY, words);
      return this.dict;
    } catch {
      // If the dictionary fetch fails, we fall through to "skip dictionary
      // check" mode: path validation still runs, so a bogus word from the
      // client gets caught unless it happens to trace a valid path.
      return null;
    }
  }
}
