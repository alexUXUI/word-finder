// .wrangler/tmp/bundle-j6esxR/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// src/GameRoom.ts
import { DurableObject } from "cloudflare:workers";

// ../src/components/boggle/multiplayer/protocol.ts
var isStr = (v) => typeof v === "string";
var isBool = (v) => typeof v === "boolean";
var parseClientFrame = (raw) => {
  if (!raw || typeof raw !== "object")
    return { ok: false, reason: "not an object" };
  const o = raw;
  if (!isStr(o.type))
    return { ok: false, reason: "missing type" };
  switch (o.type) {
    case "join":
      if (!isStr(o.playerId) || !isStr(o.displayName) || !isStr(o.gameName))
        return { ok: false, reason: "join: missing fields" };
      return {
        ok: true,
        frame: {
          type: "join",
          playerId: o.playerId,
          displayName: o.displayName,
          gameName: o.gameName
        }
      };
    case "start":
      return { ok: true, frame: { type: "start" } };
    case "found":
      if (!isStr(o.word))
        return { ok: false, reason: "found: missing word" };
      return { ok: true, frame: { type: "found", word: o.word } };
    case "ready":
      if (!isBool(o.ready))
        return { ok: false, reason: "ready: missing bool" };
      return { ok: true, frame: { type: "ready", ready: o.ready } };
    case "leave":
      return { ok: true, frame: { type: "leave" } };
    case "heartbeat":
      return { ok: true, frame: { type: "heartbeat" } };
    default:
      return { ok: false, reason: `unknown type: ${o.type}` };
  }
};
var encodeFrame = (frame) => JSON.stringify(frame);
var decodeFrame = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// ../src/components/boggle/multiplayer/path-validation.ts
var isValidBoggleWord = (word, board, size) => {
  if (size <= 0)
    return false;
  if (board.length !== size * size)
    return false;
  const target = word.toLowerCase();
  if (target.length === 0)
    return false;
  const grid = board.toLowerCase().split("");
  const neighbors = (i) => {
    const r = Math.floor(i / size);
    const c = i % size;
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0)
          continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
          out.push(nr * size + nc);
        }
      }
    }
    return out;
  };
  const dfs = (cellIdx, wordIdx, visited) => {
    if (grid[cellIdx] !== target[wordIdx])
      return false;
    if (wordIdx === target.length - 1)
      return true;
    visited.add(cellIdx);
    for (const n of neighbors(cellIdx)) {
      if (!visited.has(n) && dfs(n, wordIdx + 1, visited))
        return true;
    }
    visited.delete(cellIdx);
    return false;
  };
  for (let i = 0; i < grid.length; i++) {
    if (dfs(i, 0, /* @__PURE__ */ new Set()))
      return true;
  }
  return false;
};

// ../src/components/boggle/multiplayer/scoring.ts
var computeResults = (players) => {
  const playerEntries = Object.values(players);
  const wordCounts = /* @__PURE__ */ new Map();
  for (const p of playerEntries) {
    for (const w of p.foundWords) {
      const key = w.toLowerCase();
      wordCounts.set(key, (wordCounts.get(key) ?? 0) + 1);
    }
  }
  const rows = playerEntries.map((p) => {
    const unique = [];
    const shared = [];
    for (const w of p.foundWords) {
      const count = wordCounts.get(w.toLowerCase()) ?? 0;
      if (count === 1)
        unique.push(w);
      else
        shared.push(w);
    }
    return {
      playerId: p.id,
      displayName: p.displayName,
      foundWords: [...p.foundWords],
      uniqueWords: unique,
      sharedWords: shared,
      points: unique.length,
      // v1: flat 1-per-unique
      rank: 0
      // assigned below
    };
  });
  rows.sort((a, b) => b.points - a.points);
  let lastPoints = Number.NaN;
  let lastRank = 0;
  rows.forEach((row, i) => {
    if (row.points !== lastPoints) {
      lastRank = i + 1;
      lastPoints = row.points;
    }
    row.rank = lastRank;
  });
  const topPoints = rows.length > 0 ? rows[0].points : 0;
  const winnerIds = topPoints > 0 ? rows.filter((r) => r.points === topPoints).map((r) => r.playerId) : [];
  return { perPlayer: rows, winnerIds };
};

// src/GameRoom.ts
var STATE_KEY = "state";
var DICT_KEY = "dict-v1";
var DICT_URL = "https://boggle.pages.dev/engmix.txt";
var DEFAULT_BOARD_SIZE = 5;
var DEFAULT_MIN_LEN = 3;
var ENGLISH_FREQ = {
  a: 8.2,
  b: 1.5,
  c: 2.8,
  d: 4.3,
  e: 12.7,
  f: 2.2,
  g: 2,
  h: 6.1,
  i: 7,
  j: 0.15,
  k: 0.77,
  l: 4,
  m: 2.4,
  n: 6.7,
  o: 7.5,
  p: 1.9,
  q: 0.095,
  r: 6,
  s: 6.3,
  t: 9.1,
  u: 2.8,
  v: 0.98,
  w: 2.4,
  x: 0.15,
  y: 2,
  z: 0.074
};
var sampleBoard = (size) => {
  const entries = Object.entries(ENGLISH_FREQ);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let out = "";
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
var emptyState = (gameName) => ({
  name: gameName.toLowerCase(),
  displayName: gameName,
  state: "lobby",
  hostPlayerId: null,
  board: "",
  boardSize: DEFAULT_BOARD_SIZE,
  language: "English",
  minCharLength: DEFAULT_MIN_LEN,
  pipelineId: null,
  pipelineFinalScore: null,
  startedAt: null,
  endedAt: null,
  maxDurationMs: null,
  players: {}
});
var GameRoom = class extends DurableObject {
  gameState = null;
  dict = null;
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get(STATE_KEY);
      if (stored)
        this.gameState = stored;
    });
  }
  async fetch(request) {
    const upgrade = request.headers.get("Upgrade");
    if (upgrade !== "websocket") {
      return new Response("expected WebSocket Upgrade", { status: 426 });
    }
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/games\/([^/]+)\/?$/);
    const gameName = match ? decodeURIComponent(match[1]) : "unknown";
    if (!this.gameState) {
      this.gameState = emptyState(gameName);
      await this.persist();
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, message) {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    const decoded = decodeFrame(text);
    const parsed = parseClientFrame(decoded);
    if (!parsed.ok) {
      this.sendErrorTo(ws, "bad_frame", parsed.reason);
      return;
    }
    const frame = parsed.frame;
    const attach = ws.deserializeAttachment();
    if (!attach && frame.type !== "join") {
      this.sendErrorTo(ws, "not_joined", "send a join frame first");
      return;
    }
    switch (frame.type) {
      case "join":
        await this.handleJoin(ws, frame);
        return;
      case "start":
        await this.handleStart(ws, attach);
        return;
      case "found":
        await this.handleFound(ws, attach, frame);
        return;
      case "ready":
        await this.handleReady(ws, attach, frame);
        return;
      case "leave":
        ws.close(1e3, "leave");
        return;
      case "heartbeat":
        if (attach)
          this.touchPlayer(attach.playerId);
        return;
    }
  }
  async webSocketClose(ws, _code, _reason, _wasClean) {
    const attach = ws.deserializeAttachment();
    if (!attach || !this.gameState)
      return;
    const p = this.gameState.players[attach.playerId];
    if (p) {
      p.connected = false;
      p.lastSeenAt = Date.now();
      await this.persist();
      this.broadcast({ type: "player_left", playerId: attach.playerId });
      await this.maybeEndGame();
    }
  }
  // ───────────────────────────── handlers ─────────────────────────────
  async handleJoin(ws, frame) {
    if (!this.gameState)
      this.gameState = emptyState(frame.gameName);
    const now = Date.now();
    const existing = this.gameState.players[frame.playerId];
    if (existing) {
      existing.connected = true;
      existing.lastSeenAt = now;
      existing.displayName = frame.displayName || existing.displayName;
    } else {
      const player = {
        id: frame.playerId,
        displayName: frame.displayName || "anonymous",
        joinedAt: now,
        foundWords: [],
        readyToEnd: false,
        lastSeenAt: now,
        connected: true
      };
      this.gameState.players[frame.playerId] = player;
      if (!this.gameState.hostPlayerId) {
        this.gameState.hostPlayerId = frame.playerId;
      }
    }
    ws.serializeAttachment({ playerId: frame.playerId });
    await this.persist();
    this.sendTo(ws, { type: "state", state: this.gameState });
    this.broadcast(
      { type: "player_joined", player: this.gameState.players[frame.playerId] },
      ws
    );
  }
  async handleStart(ws, attach) {
    if (!this.gameState)
      return;
    if (this.gameState.state !== "lobby") {
      this.sendErrorTo(ws, "not_in_lobby", `state is ${this.gameState.state}`);
      return;
    }
    this.touchPlayer(attach.playerId);
    this.gameState.state = "playing";
    this.gameState.board = sampleBoard(this.gameState.boardSize);
    this.gameState.startedAt = Date.now();
    await this.persist();
    this.broadcast({
      type: "game_started",
      board: this.gameState.board,
      startedAt: this.gameState.startedAt,
      pipelineId: this.gameState.pipelineId
    });
    this.broadcast({ type: "state", state: this.gameState });
  }
  async handleFound(ws, attach, frame) {
    if (!this.gameState)
      return;
    if (this.gameState.state !== "playing") {
      this.sendErrorTo(ws, "not_playing", `state is ${this.gameState.state}`);
      return;
    }
    const word = frame.word.trim().toLowerCase();
    const player = this.gameState.players[attach.playerId];
    if (!player) {
      this.sendErrorTo(ws, "not_joined", "player not in room");
      return;
    }
    if (word.length < this.gameState.minCharLength) {
      this.sendErrorTo(ws, "too_short", `min ${this.gameState.minCharLength}`);
      return;
    }
    if (player.foundWords.includes(word)) {
      this.sendErrorTo(ws, "already_found", word);
      return;
    }
    if (!isValidBoggleWord(word, this.gameState.board, this.gameState.boardSize)) {
      this.sendErrorTo(ws, "invalid_path", word);
      return;
    }
    const dict = await this.loadDictionary();
    if (dict && !dict.has(word)) {
      this.sendErrorTo(ws, "not_a_word", word);
      return;
    }
    player.foundWords.push(word);
    this.touchPlayer(attach.playerId);
    await this.persist();
    this.broadcast({
      type: "player_found",
      playerId: attach.playerId,
      word,
      totalCount: player.foundWords.length
    });
  }
  async handleReady(ws, attach, frame) {
    if (!this.gameState)
      return;
    if (this.gameState.state !== "playing") {
      return;
    }
    const player = this.gameState.players[attach.playerId];
    if (!player)
      return;
    player.readyToEnd = frame.ready;
    this.touchPlayer(attach.playerId);
    await this.persist();
    this.broadcast({
      type: "player_ready",
      playerId: attach.playerId,
      ready: frame.ready
    });
    await this.maybeEndGame();
  }
  // ───────────────────────────── helpers ─────────────────────────────
  async maybeEndGame() {
    if (!this.gameState || this.gameState.state !== "playing")
      return;
    const connected = Object.values(this.gameState.players).filter((p) => p.connected);
    if (connected.length === 0)
      return;
    const allReady = connected.every((p) => p.readyToEnd);
    if (!allReady)
      return;
    this.gameState.state = "ended";
    this.gameState.endedAt = Date.now();
    await this.persist();
    const results = computeResults(this.gameState.players);
    this.broadcast({ type: "game_ended", results, endedAt: this.gameState.endedAt });
    this.broadcast({ type: "state", state: this.gameState });
  }
  touchPlayer(playerId) {
    if (!this.gameState)
      return;
    const p = this.gameState.players[playerId];
    if (p) {
      p.connected = true;
      p.lastSeenAt = Date.now();
    }
  }
  sendTo(ws, frame) {
    try {
      ws.send(encodeFrame(frame));
    } catch {
    }
  }
  sendErrorTo(ws, code, message) {
    this.sendTo(ws, { type: "error", code, message });
  }
  broadcast(frame, except) {
    const payload = encodeFrame(frame);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except)
        continue;
      try {
        ws.send(payload);
      } catch {
      }
    }
  }
  async persist() {
    if (this.gameState)
      await this.ctx.storage.put(STATE_KEY, this.gameState);
  }
  async loadDictionary() {
    if (this.dict)
      return this.dict;
    const cached = await this.ctx.storage.get(DICT_KEY);
    if (cached && cached.length > 0) {
      this.dict = new Set(cached);
      return this.dict;
    }
    try {
      const res = await fetch(DICT_URL);
      if (!res.ok)
        return null;
      const text = await res.text();
      const words = text.split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter(Boolean);
      this.dict = new Set(words);
      await this.ctx.storage.put(DICT_KEY, words);
      return this.dict;
    } catch {
      return null;
    }
  }
};

// src/PlayerProfile.ts
import { DurableObject as DurableObject2 } from "cloudflare:workers";
var STATE_KEY2 = "state";
var MAX_FAVORITES = 200;
var MAX_RECENT = 30;
var MAX_FRIENDS = 500;
var MAX_PLAYED_GAMES = 200;
var cors = (init = {}, body = null) => {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
  headers.set("access-control-allow-headers", "Content-Type");
  return new Response(body, { ...init, headers });
};
var json = (status, body) => cors({ status }, JSON.stringify(body));
var newId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return `b_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
};
var trim = (s, max) => s.length > max ? s.slice(0, max) : s;
var emptyState2 = (playerId) => ({
  playerId,
  displayName: "",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  favoriteBoards: [],
  friends: [],
  recentPlayers: [],
  playedGames: []
});
var PlayerProfile = class extends DurableObject2 {
  state = null;
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get(STATE_KEY2);
      if (stored)
        this.state = stored;
    });
  }
  async fetch(request) {
    if (request.method === "OPTIONS")
      return cors({ status: 204 });
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/profile\/([^/]+)(.*)$/);
    if (!m)
      return json(404, { error: "invalid profile path" });
    const playerId = decodeURIComponent(m[1]);
    const rest = m[2] || "/";
    if (!this.state) {
      this.state = emptyState2(playerId);
      await this.persist();
    }
    if (!Array.isArray(this.state.playedGames)) {
      this.state.playedGames = [];
      await this.persist();
    }
    if (request.method === "GET" && rest === "/") {
      return json(200, this.state);
    }
    if (request.method === "PATCH" && rest === "/") {
      const body = await this.readJson(request);
      if (!body)
        return json(400, { error: "invalid JSON body" });
      if (typeof body.displayName === "string") {
        this.state.displayName = trim(body.displayName.trim(), 24) || this.state.displayName;
      }
      this.state.updatedAt = Date.now();
      await this.persist();
      return json(200, this.state);
    }
    if (request.method === "POST" && rest === "/favorite-board") {
      const body = await this.readJson(request);
      if (!body || typeof body.board !== "string" || typeof body.size !== "number") {
        return json(400, { error: "board and size are required" });
      }
      const source = body.source ?? "batch";
      const existing = this.state.favoriteBoards.find(
        (f) => f.board === body.board && f.source === source
      );
      if (existing)
        return json(200, { board: existing, alreadyExists: true });
      const fav = {
        id: newId(),
        board: body.board,
        size: body.size,
        score: typeof body.score === "number" ? body.score : 0,
        pipelineId: body.pipelineId ?? null,
        source,
        notes: body.notes ?? null,
        savedAt: Date.now()
      };
      this.state.favoriteBoards = [fav, ...this.state.favoriteBoards].slice(0, MAX_FAVORITES);
      this.state.updatedAt = Date.now();
      await this.persist();
      return json(201, { board: fav, alreadyExists: false });
    }
    if (request.method === "DELETE" && rest.startsWith("/favorite-board/")) {
      const boardId = rest.slice("/favorite-board/".length);
      this.state.favoriteBoards = this.state.favoriteBoards.filter((f) => f.id !== boardId);
      this.state.updatedAt = Date.now();
      await this.persist();
      return json(200, { ok: true });
    }
    if (request.method === "POST" && rest.startsWith("/friend/")) {
      const otherId = rest.slice("/friend/".length);
      if (!otherId || otherId === playerId)
        return json(400, { error: "invalid friend id" });
      const body = await this.readJson(request) ?? { displayName: "anonymous" };
      const existing = this.state.friends.find((f) => f.playerId === otherId);
      if (existing)
        return json(200, { friend: existing, alreadyExists: true });
      const friend = {
        playerId: otherId,
        displayName: trim((body.displayName || "anonymous").trim(), 24),
        addedAt: Date.now()
      };
      this.state.friends = [friend, ...this.state.friends].slice(0, MAX_FRIENDS);
      this.state.updatedAt = Date.now();
      await this.persist();
      return json(201, { friend, alreadyExists: false });
    }
    if (request.method === "DELETE" && rest.startsWith("/friend/")) {
      const otherId = rest.slice("/friend/".length);
      this.state.friends = this.state.friends.filter((f) => f.playerId !== otherId);
      this.state.updatedAt = Date.now();
      await this.persist();
      return json(200, { ok: true });
    }
    if (request.method === "POST" && rest.startsWith("/recent/")) {
      const otherId = rest.slice("/recent/".length);
      if (!otherId || otherId === playerId)
        return json(400, { error: "invalid recent id" });
      const body = await this.readJson(request) ?? { displayName: "anonymous", gameName: "unknown" };
      const next = {
        playerId: otherId,
        displayName: trim((body.displayName || "anonymous").trim(), 24),
        lastGame: trim((body.gameName || "unknown").trim(), 48),
        lastSeenAt: Date.now()
      };
      this.state.recentPlayers = [
        next,
        ...this.state.recentPlayers.filter((r) => r.playerId !== otherId)
      ].slice(0, MAX_RECENT);
      this.state.updatedAt = Date.now();
      await this.persist();
      return json(200, { recent: next });
    }
    if (request.method === "POST" && rest === "/game") {
      const body = await this.readJson(request);
      if (!body || typeof body.board !== "string" || typeof body.size !== "number") {
        return json(400, { error: "board and size are required" });
      }
      const existing = this.state.playedGames.find(
        (g) => g.gameName === body.gameName && g.endedAt === body.endedAt
      );
      if (existing)
        return json(200, { game: existing, alreadyExists: true });
      const game = {
        id: newId(),
        gameName: trim(body.gameName.trim().toLowerCase(), 48),
        gameDisplayName: trim((body.gameDisplayName || body.gameName).trim(), 48),
        board: body.board,
        size: body.size,
        myUnique: typeof body.myUnique === "number" ? body.myUnique : 0,
        totalUnique: typeof body.totalUnique === "number" ? body.totalUnique : 0,
        playerCount: typeof body.playerCount === "number" ? body.playerCount : 1,
        won: !!body.won,
        startedAt: typeof body.startedAt === "number" ? body.startedAt : Date.now(),
        endedAt: typeof body.endedAt === "number" ? body.endedAt : Date.now()
      };
      this.state.playedGames = [game, ...this.state.playedGames].slice(0, MAX_PLAYED_GAMES);
      this.state.updatedAt = Date.now();
      await this.persist();
      return json(201, { game, alreadyExists: false });
    }
    return json(404, { error: `no route: ${request.method} ${rest}` });
  }
  async persist() {
    if (this.state)
      await this.ctx.storage.put(STATE_KEY2, this.state);
  }
  async readJson(request) {
    try {
      return await request.json();
    } catch {
      return null;
    }
  }
};

// src/index.ts
var cors2 = (status = 204) => {
  const headers = new Headers();
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
  headers.set("access-control-allow-headers", "Content-Type");
  return new Response(null, { status, headers });
};
var src_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS")
      return cors2();
    const url = new URL(request.url);
    const gameMatch = url.pathname.match(/^\/games\/([^/]+)\/?$/);
    if (gameMatch) {
      const gameName = decodeURIComponent(gameMatch[1]).toLowerCase();
      if (!gameName)
        return new Response("empty game name", { status: 400 });
      const id = env.GAME_ROOM.idFromName(gameName);
      return env.GAME_ROOM.get(id).fetch(request);
    }
    const profileMatch = url.pathname.match(/^\/profile\/([^/]+)/);
    if (profileMatch) {
      const playerId = decodeURIComponent(profileMatch[1]);
      if (!playerId)
        return new Response("empty player id", { status: 400 });
      const id = env.PROFILE.idFromName(playerId);
      return env.PROFILE.get(id).fetch(request);
    }
    return new Response(
      "multiplayer worker \u2014 try /games/:name (WS) or /profile/:id (HTTP)",
      { status: 404 }
    );
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
};
var middleware_ensure_req_body_drained_default = drainBody;
var wrap = void 0;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
var jsonError = async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
};
var middleware_miniflare3_json_error_default = jsonError;
var wrap2 = void 0;

// .wrangler/tmp/bundle-j6esxR/middleware-insertion-facade.js
var envWrappers = [wrap, wrap2].filter(Boolean);
var facade = {
  ...src_default,
  envWrappers,
  middleware: [
    middleware_ensure_req_body_drained_default,
    middleware_miniflare3_json_error_default,
    ...src_default.middleware ? src_default.middleware : []
  ].filter(Boolean)
};
var maskDurableObjectDefinition = (cls) => class extends cls {
  constructor(state, env) {
    let wrappedEnv = env;
    for (const wrapFn of envWrappers) {
      wrappedEnv = wrapFn(wrappedEnv);
    }
    super(state, wrappedEnv);
  }
};
var GameRoom2 = maskDurableObjectDefinition(GameRoom);
var PlayerProfile2 = maskDurableObjectDefinition(PlayerProfile);
var middleware_insertion_facade_default = facade;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}

// .wrangler/tmp/bundle-j6esxR/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
var __facade_modules_fetch__ = function(request, env, ctx) {
  if (middleware_insertion_facade_default.fetch === void 0)
    throw new Error("Handler does not export a fetch() function.");
  return middleware_insertion_facade_default.fetch(request, env, ctx);
};
function getMaskedEnv(rawEnv) {
  let env = rawEnv;
  if (middleware_insertion_facade_default.envWrappers && middleware_insertion_facade_default.envWrappers.length > 0) {
    for (const wrapFn of middleware_insertion_facade_default.envWrappers) {
      env = wrapFn(env);
    }
  }
  return env;
}
var registeredMiddleware = false;
var facade2 = {
  ...middleware_insertion_facade_default.tail && {
    tail: maskHandlerEnv(middleware_insertion_facade_default.tail)
  },
  ...middleware_insertion_facade_default.trace && {
    trace: maskHandlerEnv(middleware_insertion_facade_default.trace)
  },
  ...middleware_insertion_facade_default.scheduled && {
    scheduled: maskHandlerEnv(middleware_insertion_facade_default.scheduled)
  },
  ...middleware_insertion_facade_default.queue && {
    queue: maskHandlerEnv(middleware_insertion_facade_default.queue)
  },
  ...middleware_insertion_facade_default.test && {
    test: maskHandlerEnv(middleware_insertion_facade_default.test)
  },
  ...middleware_insertion_facade_default.email && {
    email: maskHandlerEnv(middleware_insertion_facade_default.email)
  },
  fetch(request, rawEnv, ctx) {
    const env = getMaskedEnv(rawEnv);
    if (middleware_insertion_facade_default.middleware && middleware_insertion_facade_default.middleware.length > 0) {
      if (!registeredMiddleware) {
        registeredMiddleware = true;
        for (const middleware of middleware_insertion_facade_default.middleware) {
          __facade_register__(middleware);
        }
      }
      const __facade_modules_dispatch__ = function(type, init) {
        if (type === "scheduled" && middleware_insertion_facade_default.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return middleware_insertion_facade_default.scheduled(controller, env, ctx);
        }
      };
      return __facade_invoke__(
        request,
        env,
        ctx,
        __facade_modules_dispatch__,
        __facade_modules_fetch__
      );
    } else {
      return __facade_modules_fetch__(request, env, ctx);
    }
  }
};
function maskHandlerEnv(handler) {
  return (data, env, ctx) => handler(data, getMaskedEnv(env), ctx);
}
var middleware_loader_entry_default = facade2;
export {
  GameRoom2 as GameRoom,
  PlayerProfile2 as PlayerProfile,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
