/**
 * Phoenix Channel — manages a single topic subscription, push/reply, and events.
 */

import type { Socket } from "./socket.js";

/**
 * Per-call overrides for a join. Kept as an options object so new knobs
 * (rejoin policy, headers, etc.) can be added without another positional
 * argument in generated SDK call sites.
 */
export interface JoinOptions {
  /** Override the socket's default reply timeout for this join. */
  timeoutMs?: number;
}

export class ChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelError";
  }
}

type ChannelState = "closed" | "joining" | "joined" | "leaving" | "errored";

export class Channel {
  private socket: Socket;
  private topic: string;
  private params: Record<string, unknown>;

  private _state: ChannelState = "closed";
  private joinRef: string | null = null;
  private eventHandlers = new Map<string, ((payload: unknown) => void)[]>();
  private pendingReplies = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private pushBuffer: {
    event: string;
    payload: unknown;
    timeoutMs: number;
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];

  constructor(
    socket: Socket,
    topic: string,
    params: Record<string, unknown>
  ) {
    this.socket = socket;
    this.topic = topic;
    this.params = params;
  }

  get state(): ChannelState {
    return this._state;
  }

  get isJoined(): boolean {
    return this._state === "joined";
  }

  // ─── Join / Leave ─────────────────────────────────────────

  async join(
    payload?: Record<string, unknown>,
    options?: JoinOptions
  ): Promise<Record<string, unknown>> {
    if (this._state === "joined") return {};

    const timeout = options?.timeoutMs ?? this.socket.timeoutMs;
    this._state = "joining";
    const ref = this.socket.makeRef();
    this.joinRef = ref;

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingReplies.delete(ref);
        this._state = "errored";
        reject(new ChannelError(`Join timed out for ${this.topic}`));
      }, timeout);

      this.pendingReplies.set(ref, {
        resolve: (replyPayload: unknown) => {
          clearTimeout(timer);
          const p = replyPayload as { status: string; response: Record<string, unknown> };
          if (p.status === "ok") {
            this._state = "joined";
            this.flushPushBuffer();
            resolve(p.response ?? {});
          } else {
            this._state = "errored";
            reject(
              new ChannelError(
                `Join rejected for ${this.topic}: ${JSON.stringify(p.response)}`
              )
            );
          }
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.socket.send(ref, ref, this.topic, "phx_join", payload ?? this.params);
    });
  }

  async leave(timeoutMs?: number): Promise<void> {
    if (this._state === "closed") return;

    const timeout = timeoutMs ?? this.socket.timeoutMs;
    this._state = "leaving";
    const ref = this.socket.makeRef();

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingReplies.delete(ref);
        finish();
      }, timeout);

      const finish = () => {
        clearTimeout(timer);
        this._state = "closed";
        this.joinRef = null;
        this.socket.removeChannel(this.topic);
        resolve();
      };

      this.pendingReplies.set(ref, {
        resolve: () => finish(),
        reject: () => finish(),
      });

      this.socket.send(this.joinRef, ref, this.topic, "phx_leave", {});
    });
  }

  /** @internal Rejoin after reconnection. */
  async rejoin(): Promise<void> {
    if (this._state === "closed" || this._state === "leaving") return;
    this._state = "closed";
    this.joinRef = null;
    try {
      await this.join();
    } catch {
      this._state = "errored";
    }
  }

  // ─── Push / Reply ─────────────────────────────────────────

  async push(
    event: string,
    payload: unknown = {},
    timeoutMs?: number
  ): Promise<unknown> {
    const timeout = timeoutMs ?? this.socket.timeoutMs;

    if (this._state !== "joined") {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = this.pushBuffer.findIndex((b) => b.timer === timer);
          if (idx !== -1) this.pushBuffer.splice(idx, 1);
          reject(new ChannelError(`Push '${event}' timed out (buffered)`));
        }, timeout);
        this.pushBuffer.push({ event, payload, timeoutMs: timeout, resolve, reject, timer });
      });
    }

    return this.doPush(event, payload, timeout);
  }

  private doPush(
    event: string,
    payload: unknown,
    timeoutMs: number
  ): Promise<unknown> {
    const ref = this.socket.makeRef();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingReplies.delete(ref);
        reject(
          new ChannelError(`Push '${event}' timed out on ${this.topic}`)
        );
      }, timeoutMs);

      this.pendingReplies.set(ref, {
        resolve: (v: unknown) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e: Error) => {
          clearTimeout(timer);
          reject(e);
        },
      });

      this.socket.send(this.joinRef, ref, this.topic, event, payload);
    });
  }

  private flushPushBuffer(): void {
    const buffer = this.pushBuffer.splice(0);
    for (const { event, payload, timeoutMs, resolve, reject, timer } of buffer) {
      // Cancel the buffered timeout — doPush will manage its own timeout
      // using the caller's original timeoutMs, not the socket default
      clearTimeout(timer);
      this.doPush(event, payload, timeoutMs).then(resolve, reject);
    }
  }

  // ─── Event handlers ──────────────────────────────────────

  on(event: string, callback: (payload: unknown) => void): () => void {
    const handlers = this.eventHandlers.get(event) ?? [];
    handlers.push(callback);
    this.eventHandlers.set(event, handlers);

    return () => {
      const current = this.eventHandlers.get(event);
      if (current) {
        this.eventHandlers.set(
          event,
          current.filter((h) => h !== callback)
        );
      }
    };
  }

  // ─── Internal message dispatch ────────────────────────────

  /** @internal Called by Socket when a message arrives for this topic. */
  onMessage(
    joinRef: string | null,
    ref: string | null,
    event: string,
    payload: unknown
  ): void {
    // Ignore messages from stale join
    if (joinRef !== null && joinRef !== this.joinRef) return;

    if (event === "phx_reply") {
      this.handleReply(ref, payload);
    } else if (event === "phx_close") {
      this._state = "closed";
      this.triggerEvent("phx_close", payload);
    } else if (event === "phx_error") {
      this._state = "errored";
      this.triggerEvent("phx_error", payload);
    } else {
      this.triggerEvent(event, payload);
    }
  }

  private handleReply(ref: string | null, payload: unknown): void {
    if (!ref) return;
    const pending = this.pendingReplies.get(ref);
    if (pending) {
      this.pendingReplies.delete(ref);
      pending.resolve(payload);
    }
  }

  private triggerEvent(event: string, payload: unknown): void {
    const handlers = this.eventHandlers.get(event) ?? [];
    for (const handler of handlers) {
      try {
        handler(payload);
      } catch {
        // ignore handler errors
      }
    }
  }
}
