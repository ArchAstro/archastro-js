/**
 * Phoenix Socket — manages WebSocket connection, heartbeat, and channels.
 *
 * Wire protocol: JSON arrays [join_ref, ref, topic, event, payload]
 * Protocol version: 2.0.0
 */

import { Channel } from "./channel.js";

/** Default reconnect backoff schedule (ms), matching the Phoenix JS client. */
const DEFAULT_BACKOFF_MS = [10, 50, 100, 150, 200, 250, 500, 1000, 2000];
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface SocketConfig {
  /** Query params appended to the WebSocket URL (e.g., { token, api_key }). */
  params?: Record<string, string>;
  /** Heartbeat interval in milliseconds (default 30000). */
  heartbeatIntervalMs?: number;
  /** Default timeout for push/join operations in milliseconds (default 10000). */
  timeoutMs?: number;
  /** Reconnect backoff schedule in milliseconds. */
  reconnectBackoffMs?: number[];
  /** Whether to automatically reconnect on disconnect (default true). */
  autoReconnect?: boolean;
}

export type SocketEvent =
  | { type: "open" }
  | { type: "close"; code: number; reason: string }
  | { type: "error"; error: unknown };

type WebSocketLike = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  readyState: number;
};

export class Socket {
  private baseUrl: string;
  private params: Record<string, string>;
  private heartbeatIntervalMs: number;
  readonly timeoutMs: number;
  private backoff: number[];
  private autoReconnect: boolean;

  private ws: WebSocketLike | null = null;
  private ref = 0;
  private pendingHeartbeatRef: string | null = null;
  private channels = new Map<string, Channel>();
  private connected = false;
  private closing = false;
  private reconnectAttempt = 0;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private eventListeners: ((event: SocketEvent) => void)[] = [];

  constructor(url: string, config: SocketConfig = {}) {
    this.baseUrl = url;
    this.params = config.params ?? {};
    this.heartbeatIntervalMs =
      config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.backoff = config.reconnectBackoffMs ?? DEFAULT_BACKOFF_MS;
    this.autoReconnect = config.autoReconnect ?? true;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  makeRef(): string {
    this.ref++;
    return String(this.ref);
  }

  private buildUrl(): string {
    const url = new URL(this.baseUrl);
    url.searchParams.set("vsn", "2.0.0");
    for (const [key, value] of Object.entries(this.params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  // ─── Connection lifecycle ─────────────────────────────────

  async connect(): Promise<void> {
    this.closing = false;
    this.reconnectAttempt = 0;
    await this.doConnect();
  }

  private async doConnect(): Promise<void> {
    const url = this.buildUrl();
    const ws = await this.createWebSocket(url);

    return new Promise<void>((resolve, reject) => {

      // These handlers manage only the initial connection attempt.
      // Once the connection opens, setupReceive() takes over for
      // subsequent close/error events.
      let settled = false;

      const onOpen = () => {
        cleanup();
        settled = true;
        this.ws = ws;
        this.connected = true;
        this.reconnectAttempt = 0;
        this.startHeartbeat();

        // Now install the long-lived receive handler for messages
        // and post-connect close events.
        this.setupReceive(ws);

        this.emit({ type: "open" });

        // Rejoin channels
        for (const channel of this.channels.values()) {
          if (
            channel.state === "joined" ||
            channel.state === "errored"
          ) {
            channel.rejoin().catch(() => {});
          }
        }

        resolve();
      };

      const onError = (event: unknown) => {
        if (settled) return;
        cleanup();
        settled = true;
        this.connected = false;
        const err =
          event instanceof Error ? event : new Error("WebSocket connection failed");
        this.emit({ type: "error", error: err });
        if (this.autoReconnect && !this.closing) {
          this.scheduleReconnect().then(resolve, reject);
        } else {
          reject(err);
        }
      };

      const onClose = (event: unknown) => {
        if (settled) return;
        cleanup();
        settled = true;
        const closeEvent = event as { code?: number; reason?: string };
        this.connected = false;
        this.emit({
          type: "close",
          code: closeEvent.code ?? 1006,
          reason: closeEvent.reason ?? "",
        });
        if (this.autoReconnect && !this.closing) {
          this.scheduleReconnect().then(resolve, reject);
        } else {
          reject(new Error(`WebSocket closed: ${closeEvent.code ?? 1006}`));
        }
      };

      const cleanup = () => {
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onError);
        ws.removeEventListener("close", onClose);
      };

      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onError);
      ws.addEventListener("close", onClose);
    });
  }

  async disconnect(): Promise<void> {
    this.closing = true;
    this.connected = false;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, "client disconnect");
      this.ws = null;
    }
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.closing) return;
    const idx = Math.min(this.reconnectAttempt, this.backoff.length - 1);
    const delayMs = this.backoff[idx]!;
    this.reconnectAttempt++;
    await new Promise((r) => setTimeout(r, delayMs));
    if (!this.closing) {
      await this.doConnect();
    }
  }

  // ─── Channel management ───────────────────────────────────

  channel(topic: string, params: Record<string, unknown> = {}): Channel {
    const existing = this.channels.get(topic);
    if (existing) return existing;
    const ch = new Channel(this, topic, params);
    this.channels.set(topic, ch);
    return ch;
  }

  removeChannel(topic: string): void {
    this.channels.delete(topic);
  }

  // ─── Send ─────────────────────────────────────────────────

  send(
    joinRef: string | null,
    ref: string | null,
    topic: string,
    event: string,
    payload: unknown
  ): void {
    if (!this.ws || !this.connected) {
      throw new Error("Socket is not connected");
    }
    const msg = JSON.stringify([joinRef, ref, topic, event, payload]);
    this.ws.send(msg);
  }

  // ─── Receive ──────────────────────────────────────────────

  /**
   * Install long-lived message and close handlers on an already-open WebSocket.
   * Called once after the initial connection succeeds — NOT during the connection
   * handshake, so there's no overlap with doConnect's one-shot handlers.
   */
  private setupReceive(ws: WebSocketLike): void {
    ws.addEventListener("message", (event: unknown) => {
      const msgEvent = event as { data?: string };
      if (!msgEvent.data) return;
      try {
        const msg = JSON.parse(
          typeof msgEvent.data === "string"
            ? msgEvent.data
            : String(msgEvent.data)
        );
        if (!Array.isArray(msg) || msg.length !== 5) return;
        const [joinRef, ref, topic, eventName, payload] = msg;
        this.dispatch(joinRef, ref, topic, eventName, payload);
      } catch {
        // ignore parse errors
      }
    });

    ws.addEventListener("close", (event: unknown) => {
      const closeEvent = event as { code?: number; reason?: string };
      this.connected = false;
      this.stopHeartbeat();
      this.emit({
        type: "close",
        code: closeEvent.code ?? 1006,
        reason: closeEvent.reason ?? "",
      });
      if (this.autoReconnect && !this.closing) {
        this.scheduleReconnect().catch(() => {});
      }
    });
  }

  private dispatch(
    joinRef: string | null,
    ref: string | null,
    topic: string,
    event: string,
    payload: unknown
  ): void {
    // Heartbeat reply
    if (ref && ref === this.pendingHeartbeatRef) {
      this.pendingHeartbeatRef = null;
      return;
    }

    // Route to channel
    const channel = this.channels.get(topic);
    if (channel) {
      channel.onMessage(joinRef, ref, event, payload);
    }
  }

  // ─── Heartbeat ────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.connected) return;

      if (this.pendingHeartbeatRef !== null) {
        // Previous heartbeat not acknowledged
        this.pendingHeartbeatRef = null;
        this.ws?.close(1000, "heartbeat timeout");
        return;
      }

      const ref = this.makeRef();
      this.pendingHeartbeatRef = ref;
      try {
        this.send(null, ref, "phoenix", "heartbeat", {});
      } catch {
        this.ws?.close(1000, "heartbeat send failed");
      }
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ─── Events ───────────────────────────────────────────────

  onEvent(listener: (event: SocketEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  private emit(event: SocketEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  // ─── WebSocket factory ────────────────────────────────────

  private async createWebSocket(url: string): Promise<WebSocketLike> {
    // Browser or Node >= 22 (has global WebSocket)
    if (typeof globalThis.WebSocket !== "undefined") {
      return new globalThis.WebSocket(url) as unknown as WebSocketLike;
    }

    // Node.js without global WebSocket — lazy-load `ws`. The Function
    // constructor hides the import specifier from bundlers so client builds
    // (Webpack, Turbopack) don't try to resolve `ws` for the browser.
    const WS = await loadWsCtor();
    return new WS(url);
  }
}

let wsCtorPromise: Promise<new (url: string) => WebSocketLike> | null = null;

function loadWsCtor(): Promise<new (url: string) => WebSocketLike> {
  if (!wsCtorPromise) {
    const dynamicImport = new Function("s", "return import(s)") as (
      s: string,
    ) => Promise<{ default: new (url: string) => WebSocketLike }>;
    wsCtorPromise = dynamicImport("ws").then((m) => m.default);
  }
  return wsCtorPromise;
}

export { Channel, ChannelError } from "./channel.js";
