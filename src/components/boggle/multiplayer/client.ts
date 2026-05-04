// Browser-side WebSocket client for the multiplayer GameRoom.
//
// Responsibilities:
//   - Hold a single WebSocket; auto-reconnect with exponential backoff
//     (1s, 2s, 4s, 8s, 16s, capped at 30s) on unexpected close.
//   - Replay an outbound queue after reconnect — messages sent while
//     disconnected get buffered and flushed once joined.
//   - Heartbeat every 25s so an idle Hibernation-API DO + the browser
//     network stack both see traffic.
//   - On reconnect: re-issue `join` with the same playerId so the server
//     restores the player's `connected = true` state and preserves their
//     foundWords.
//   - Surface every incoming server frame to a single `onFrame` handler
//     and every status transition to `onStatus`.
//
// All wiring with Qwik happens *outside* this class — instances are wrapped
// in noSerialize() and stored on MultiplayerCtx.

import {
  encodeFrame,
  decodeFrame,
  type ClientFrame,
  type ServerFrame,
} from './protocol';

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed'
  | 'error';

export interface MultiplayerClientOptions {
  url: string;                      // ws://host/games/<name>
  playerId: string;
  displayName: string;
  gameName: string;
  onFrame: (frame: ServerFrame) => void;
  onStatus: (status: ConnectionStatus) => void;
}

const HEARTBEAT_MS = 25_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'idle';
  private outbox: ClientFrame[] = [];
  private joined = false;          // server has acknowledged this socket
  private explicitlyClosed = false;
  private retryAttempt = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private opts: MultiplayerClientOptions) {}

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.explicitlyClosed = false;
    this.setStatus(this.retryAttempt > 0 ? 'reconnecting' : 'connecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.opts.url);
    } catch {
      this.setStatus('error');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.retryAttempt = 0;
      this.setStatus('connected');
      // Always (re-)issue join first so the server attaches our playerId
      // to this socket. Re-joins with the same id are idempotent on the
      // server side; they restore the player's foundWords.
      this.sendNow({
        type: 'join',
        playerId: this.opts.playerId,
        displayName: this.opts.displayName,
        gameName: this.opts.gameName,
      });
      this.joined = true;
      this.flushOutbox();
      this.startHeartbeat();
    });

    ws.addEventListener('message', (ev: MessageEvent) => {
      const text = typeof ev.data === 'string' ? ev.data : '';
      const frame = decodeFrame(text);
      if (!frame || typeof frame !== 'object' || !('type' in frame)) return;
      this.opts.onFrame(frame as ServerFrame);
    });

    ws.addEventListener('close', () => {
      this.stopHeartbeat();
      this.joined = false;
      this.ws = null;
      if (this.explicitlyClosed) {
        this.setStatus('closed');
        return;
      }
      this.scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      // The browser will fire `close` right after; status update happens there.
    });
  }

  disconnect(): void {
    this.explicitlyClosed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try { this.ws?.close(1000, 'client disconnect'); } catch { /* noop */ }
    this.ws = null;
    this.outbox = [];
    this.setStatus('closed');
  }

  send(frame: ClientFrame): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.joined) {
      this.sendNow(frame);
    } else {
      // Buffer for replay after reconnect. Drop heartbeats — they're stale.
      if (frame.type !== 'heartbeat') this.outbox.push(frame);
    }
  }

  /** Update display name preference; takes effect on next reconnect/join. */
  setDisplayName(name: string): void {
    this.opts.displayName = name;
  }

  // ─────────────────────── internals ───────────────────────

  private sendNow(frame: ClientFrame): void {
    try {
      this.ws?.send(encodeFrame(frame));
    } catch {
      // Either socket flipped to CLOSED between check and send, or send
      // throws on backpressure. Treat as needing reconnect.
    }
  }

  private flushOutbox(): void {
    if (this.outbox.length === 0) return;
    const pending = this.outbox;
    this.outbox = [];
    for (const f of pending) this.sendNow(f);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendNow({ type: 'heartbeat' });
      }
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(
      BACKOFF_MAX_MS,
      BACKOFF_MIN_MS * Math.pow(2, this.retryAttempt),
    );
    this.retryAttempt += 1;
    this.setStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private setStatus(s: ConnectionStatus): void {
    if (s === this.status) return;
    this.status = s;
    try { this.opts.onStatus(s); } catch { /* noop */ }
  }
}

/** Build the WS URL for a game name based on env.
 *
 *  - Production (Cloudflare Pages): `wss://<host>/api/games/<name>` — the
 *    Pages Function proxies the upgrade to the bound multiplayer Worker.
 *  - Dev (Qwik vite server on localhost:5173 etc.): the Pages Function
 *    isn't running, so we point straight at the local wrangler dev for
 *    the multiplayer Worker on :8788.
 *  - Override: `PUBLIC_MULTIPLAYER_WS_URL` or `VITE_MULTIPLAYER_WS_URL`
 *    env var (prefix exposed to client via Vite) wins over both.
 */
export const buildGameUrl = (gameName: string): string => {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const override = env.PUBLIC_MULTIPLAYER_WS_URL ?? env.VITE_MULTIPLAYER_WS_URL;
  if (override) {
    const base = override.replace(/\/+$/, '');
    return `${base}/games/${encodeURIComponent(gameName)}`;
  }
  if (typeof window === 'undefined') return '';
  const host = window.location.host;
  const isLocalDev = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$)/.test(host);
  if (isLocalDev) {
    return `ws://localhost:8788/games/${encodeURIComponent(gameName)}`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${host}/api/games/${encodeURIComponent(gameName)}`;
};
