// Multiplayer WebSocket protocol — shared between client and the GameRoom DO.
//
// Pure TypeScript: no zod, no runtime deps. Both directions go through
// `parseFrame` which validates the discriminated `type` and the payload
// shape. Anything malformed is rejected with a typed `ParseError` so the
// DO can answer with `error: bad_frame` rather than crashing.

export type GameLifecycle = 'lobby' | 'playing' | 'ended';

export interface PlayerState {
  id: string;
  displayName: string;
  joinedAt: number;
  foundWords: string[];
  readyToEnd: boolean;
  lastSeenAt: number;
  connected: boolean;
}

export interface GameState {
  name: string;
  displayName: string;
  state: GameLifecycle;
  hostPlayerId: string | null;
  board: string;
  boardSize: number;
  language: 'English';
  minCharLength: number;
  pipelineId: string | null;
  pipelineFinalScore: number | null;
  startedAt: number | null;
  endedAt: number | null;
  maxDurationMs: number | null;
  players: Record<string, PlayerState>;
}

export interface ResultsRow {
  playerId: string;
  displayName: string;
  foundWords: string[];
  uniqueWords: string[];
  sharedWords: string[];
  points: number;
  rank: number;
}

export interface ResultsPayload {
  perPlayer: ResultsRow[];
  winnerIds: string[];
}

// ───────────────────────────── client → server ─────────────────────────────

export interface JoinFrame {
  type: 'join';
  playerId: string;
  displayName: string;
  gameName: string;
}
export interface StartFrame {
  type: 'start';
}
export interface FoundFrame {
  type: 'found';
  word: string;
}
export interface ReadyFrame {
  type: 'ready';
  ready: boolean;
}
export interface LeaveFrame {
  type: 'leave';
}
export interface HeartbeatFrame {
  type: 'heartbeat';
}

export type ClientFrame =
  | JoinFrame
  | StartFrame
  | FoundFrame
  | ReadyFrame
  | LeaveFrame
  | HeartbeatFrame;

// ───────────────────────────── server → client ─────────────────────────────

export type ServerErrorCode =
  | 'bad_frame'
  | 'not_joined'
  | 'not_in_lobby'
  | 'not_playing'
  | 'too_short'
  | 'not_a_word'
  | 'invalid_path'
  | 'already_found'
  | 'name_taken'
  | 'rate_limited';

export interface StateFrame {
  type: 'state';
  state: GameState;
}
export interface PlayerJoinedFrame {
  type: 'player_joined';
  player: PlayerState;
}
export interface PlayerLeftFrame {
  type: 'player_left';
  playerId: string;
}
export interface PlayerFoundFrame {
  type: 'player_found';
  playerId: string;
  word: string;
  totalCount: number;
}
export interface PlayerReadyFrame {
  type: 'player_ready';
  playerId: string;
  ready: boolean;
}
export interface GameStartedFrame {
  type: 'game_started';
  board: string;
  startedAt: number;
  pipelineId: string | null;
}
export interface GameEndedFrame {
  type: 'game_ended';
  results: ResultsPayload;
  endedAt: number;
}
export interface ErrorFrame {
  type: 'error';
  code: ServerErrorCode;
  message: string;
}

export type ServerFrame =
  | StateFrame
  | PlayerJoinedFrame
  | PlayerLeftFrame
  | PlayerFoundFrame
  | PlayerReadyFrame
  | GameStartedFrame
  | GameEndedFrame
  | ErrorFrame;

// ───────────────────────────── parse + serialize ─────────────────────────────

export interface ParseError {
  ok: false;
  reason: string;
}
export interface ParseOk<T> {
  ok: true;
  frame: T;
}
export type ParseResult<T> = ParseOk<T> | ParseError;

const isStr = (v: unknown): v is string => typeof v === 'string';
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

export const parseClientFrame = (raw: unknown): ParseResult<ClientFrame> => {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' };
  const o = raw as Record<string, unknown>;
  if (!isStr(o.type)) return { ok: false, reason: 'missing type' };
  switch (o.type) {
    case 'join':
      if (!isStr(o.playerId) || !isStr(o.displayName) || !isStr(o.gameName))
        return { ok: false, reason: 'join: missing fields' };
      return {
        ok: true,
        frame: {
          type: 'join',
          playerId: o.playerId,
          displayName: o.displayName,
          gameName: o.gameName,
        },
      };
    case 'start':
      return { ok: true, frame: { type: 'start' } };
    case 'found':
      if (!isStr(o.word)) return { ok: false, reason: 'found: missing word' };
      return { ok: true, frame: { type: 'found', word: o.word } };
    case 'ready':
      if (!isBool(o.ready)) return { ok: false, reason: 'ready: missing bool' };
      return { ok: true, frame: { type: 'ready', ready: o.ready } };
    case 'leave':
      return { ok: true, frame: { type: 'leave' } };
    case 'heartbeat':
      return { ok: true, frame: { type: 'heartbeat' } };
    default:
      return { ok: false, reason: `unknown type: ${o.type}` };
  }
};

export const encodeFrame = (frame: ClientFrame | ServerFrame): string =>
  JSON.stringify(frame);

export const decodeFrame = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
