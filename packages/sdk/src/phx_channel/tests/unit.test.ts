/**
 * Unit tests for the Phoenix Channel client — no server required.
 * Tests protocol logic, state machine, message formatting, ref tracking, etc.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Channel, ChannelError } from "../channel.js";
import { Socket } from "../socket.js";

// ─── Mock Socket ────────────────────────────────────────────────

function createMockSocket() {
  let refCounter = 0;
  const sent: unknown[][] = [];

  return {
    sent,
    timeoutMs: 1000,
    makeRef() {
      refCounter++;
      return String(refCounter);
    },
    send(
      joinRef: string | null,
      ref: string | null,
      topic: string,
      event: string,
      payload: unknown
    ) {
      sent.push([joinRef, ref, topic, event, payload]);
    },
    removeChannel(_topic: string) {},
  };
}

/** Helper: create a channel and join it. */
async function joinedChannel() {
  const socket = createMockSocket();
  const ch = new Channel(socket as any, "test:topic", {});
  const joinPromise = ch.join(undefined, { timeoutMs: 500 });
  const [joinRef, ref] = socket.sent[0]!;
  ch.onMessage(joinRef as string, ref as string, "phx_reply", {
    status: "ok",
    response: {},
  });
  await joinPromise;
  socket.sent.length = 0;
  return { socket, ch };
}

// ─── Socket unit tests ──────────────────────────────────────────

describe("Socket", () => {
  it("starts disconnected", () => {
    const socket = new Socket("ws://localhost:4000/socket/websocket");
    expect(socket.isConnected).toBe(false);
  });

  it("generates incrementing string refs", () => {
    const socket = new Socket("ws://localhost:4000/socket/websocket");
    expect(socket.makeRef()).toBe("1");
    expect(socket.makeRef()).toBe("2");
    expect(socket.makeRef()).toBe("3");
  });

  it("creates channels by topic", () => {
    const socket = new Socket("ws://localhost:4000/socket/websocket");
    const ch1 = socket.channel("room:lobby");
    const ch2 = socket.channel("room:lobby");
    const ch3 = socket.channel("room:other");
    expect(ch1).toBe(ch2);
    expect(ch1).not.toBe(ch3);
  });

  it("removes channels by topic", () => {
    const socket = new Socket("ws://localhost:4000/socket/websocket");
    const ch = socket.channel("room:lobby");
    socket.removeChannel("room:lobby");
    const ch2 = socket.channel("room:lobby");
    expect(ch2).not.toBe(ch);
  });

  it("stores timeout config", () => {
    const socket = new Socket("ws://localhost:4000/socket/websocket", {
      timeoutMs: 2000,
    });
    expect(socket.timeoutMs).toBe(2000);
  });

  it("uses default timeout of 10000ms", () => {
    const socket = new Socket("ws://localhost:4000/socket/websocket");
    expect(socket.timeoutMs).toBe(10000);
  });

  it("send throws when not connected", () => {
    const socket = new Socket("ws://localhost:4000/socket/websocket");
    expect(() => {
      socket.send(null, "1", "test", "event", {});
    }).toThrow("not connected");
  });

  it("onEvent returns an unsubscribe function", () => {
    const socket = new Socket("ws://localhost:4000/socket/websocket");
    const unsub = socket.onEvent(() => {});
    expect(typeof unsub).toBe("function");
    unsub(); // should not throw
  });

  it("falls back to ws package when globalThis.WebSocket is unavailable", async () => {
    // Temporarily hide the global WebSocket to force the ws fallback
    const original = globalThis.WebSocket;
    try {
      (globalThis as any).WebSocket = undefined;

      // Connect to a port that's not listening — we just want to verify
      // the ws fallback doesn't throw ReferenceError: require is not defined
      const socket = new Socket("ws://localhost:19998/socket/websocket", {
        autoReconnect: false,
      });

      // Should reject with a connection error, NOT a ReferenceError
      try {
        await socket.connect();
      } catch (err: unknown) {
        expect(err).not.toBeInstanceOf(ReferenceError);
        // It should be a normal connection failure
        expect(err).toBeInstanceOf(Error);
      }
    } finally {
      globalThis.WebSocket = original;
    }
  });
});

// ─── Socket connection failure semantics ────────────────────────

describe("Socket connection failures", () => {
  it("connect() rejects when autoReconnect is false and connection fails", async () => {
    // Connect to a port nothing is listening on
    const socket = new Socket("ws://localhost:19999/socket/websocket", {
      autoReconnect: false,
    });

    await expect(socket.connect()).rejects.toThrow();
    expect(socket.isConnected).toBe(false);
  });

  it("does not trigger duplicate reconnects on connection failure", async () => {
    let reconnectCount = 0;
    const events: string[] = [];

    const socket = new Socket("ws://localhost:19999/socket/websocket", {
      autoReconnect: true,
      // Use a long backoff so we can count attempts without them completing
      reconnectBackoffMs: [50000],
    });

    socket.onEvent((e) => {
      events.push(e.type);
    });

    // Start connect — it will fail and schedule ONE reconnect
    const connectPromise = socket.connect();

    // Wait a bit for the failure to propagate
    await new Promise((r) => setTimeout(r, 500));

    // Disconnect to stop the reconnect loop
    await socket.disconnect();

    // Should have at most one error and one close, not hundreds
    const errorCount = events.filter((e) => e === "error").length;
    const closeCount = events.filter((e) => e === "close").length;

    // The key assertion: no storm of events
    expect(errorCount + closeCount).toBeLessThanOrEqual(3);
  }, 10000);
});

// ─── Channel state machine ──────────────────────────────────────

describe("Channel state machine", () => {
  it("starts in closed state", () => {
    const socket = createMockSocket();
    const ch = new Channel(socket as any, "test:topic", {});
    expect(ch.state).toBe("closed");
    expect(ch.isJoined).toBe(false);
  });

  it("transitions to joined on successful join", async () => {
    const socket = createMockSocket();
    const ch = new Channel(socket as any, "test:topic", { key: "val" });

    const joinPromise = ch.join(undefined, { timeoutMs: 500 });

    expect(socket.sent).toHaveLength(1);
    const [joinRef, ref, topic, event, payload] = socket.sent[0]!;
    expect(topic).toBe("test:topic");
    expect(event).toBe("phx_join");
    expect(payload).toEqual({ key: "val" });
    expect(joinRef).toBe(ref);

    ch.onMessage(joinRef as string, ref as string, "phx_reply", {
      status: "ok",
      response: { welcome: true },
    });

    const response = await joinPromise;
    expect(response).toEqual({ welcome: true });
    expect(ch.state).toBe("joined");
    expect(ch.isJoined).toBe(true);
  });

  it("returns {} immediately when already joined", async () => {
    const { ch } = await joinedChannel();
    const response = await ch.join(undefined, { timeoutMs: 500 });
    expect(response).toEqual({});
  });

  it("transitions to errored on join rejection", async () => {
    const socket = createMockSocket();
    const ch = new Channel(socket as any, "test:topic", {});
    const joinPromise = ch.join(undefined, { timeoutMs: 500 });
    const [joinRef, ref] = socket.sent[0]!;

    ch.onMessage(joinRef as string, ref as string, "phx_reply", {
      status: "error",
      response: { reason: "unauthorized" },
    });

    await expect(joinPromise).rejects.toThrow(ChannelError);
    await expect(joinPromise).rejects.toThrow("unauthorized");
    expect(ch.state).toBe("errored");
  });

  it("times out on join if no reply", async () => {
    const socket = createMockSocket();
    const ch = new Channel(socket as any, "test:topic", {});
    await expect(ch.join(undefined, { timeoutMs: 50 })).rejects.toThrow("timed out");
  });

  it("transitions to closed on phx_close", async () => {
    const { ch } = await joinedChannel();
    ch.onMessage(null, null, "phx_close", {});
    expect(ch.state).toBe("closed");
  });

  it("transitions to errored on phx_error", async () => {
    const { ch } = await joinedChannel();
    ch.onMessage(null, null, "phx_error", { reason: "crash" });
    expect(ch.state).toBe("errored");
  });
});

// ─── Channel push/reply ─────────────────────────────────────────

describe("Channel push/reply", () => {
  it("sends push with correct wire format", async () => {
    const { socket, ch } = await joinedChannel();

    const pushPromise = ch.push("my_event", { data: 123 }, 500);

    expect(socket.sent).toHaveLength(1);
    const [joinRef, ref, topic, event, payload] = socket.sent[0]!;
    expect(topic).toBe("test:topic");
    expect(event).toBe("my_event");
    expect(payload).toEqual({ data: 123 });
    expect(joinRef).not.toBeNull();

    ch.onMessage(joinRef as string, ref as string, "phx_reply", {
      status: "ok",
      response: { id: "abc" },
    });

    const result = await pushPromise;
    expect(result).toEqual({ status: "ok", response: { id: "abc" } });
  });

  it("times out on push if no reply", async () => {
    const { ch } = await joinedChannel();
    await expect(ch.push("slow_event", {}, 50)).rejects.toThrow("timed out");
  });

  it("uses default payload of {} when none provided", async () => {
    const { socket, ch } = await joinedChannel();
    const pushPromise = ch.push("no_payload", undefined, 500);

    const [, , , , payload] = socket.sent[0]!;
    expect(payload).toEqual({});

    const [joinRef, ref] = socket.sent[0]!;
    ch.onMessage(joinRef as string, ref as string, "phx_reply", {
      status: "ok",
      response: {},
    });
    await pushPromise;
  });

  it("tracks multiple concurrent pushes independently", async () => {
    const { socket, ch } = await joinedChannel();

    const p1 = ch.push("evt_a", { n: 1 }, 500);
    const p2 = ch.push("evt_b", { n: 2 }, 500);

    expect(socket.sent).toHaveLength(2);
    const [jr1, ref1] = socket.sent[0]!;
    const [jr2, ref2] = socket.sent[1]!;

    // Reply to second first — each resolves independently
    ch.onMessage(jr2 as string, ref2 as string, "phx_reply", {
      status: "ok",
      response: { from: "b" },
    });
    ch.onMessage(jr1 as string, ref1 as string, "phx_reply", {
      status: "ok",
      response: { from: "a" },
    });

    const r1 = (await p1) as any;
    const r2 = (await p2) as any;
    expect(r1.response.from).toBe("a");
    expect(r2.response.from).toBe("b");
  });

  it("each push gets a unique ref", async () => {
    const { socket, ch } = await joinedChannel();
    const promises = [
      ch.push("a", {}, 500),
      ch.push("b", {}, 500),
      ch.push("c", {}, 500),
    ];

    const refs = socket.sent.map((m) => m[1]);
    const uniqueRefs = new Set(refs);
    expect(uniqueRefs.size).toBe(3);

    // Resolve all to avoid unhandled rejections
    for (const msg of socket.sent) {
      ch.onMessage(msg[0] as string, msg[1] as string, "phx_reply", {
        status: "ok",
        response: {},
      });
    }
    await Promise.all(promises);
  });
});

// ─── Channel event handlers ─────────────────────────────────────

describe("Channel event handlers", () => {
  it("dispatches events to registered handlers", async () => {
    const { ch } = await joinedChannel();
    const received: unknown[] = [];
    ch.on("my_event", (payload) => received.push(payload));
    ch.onMessage(null, null, "my_event", { data: "hello" });
    expect(received).toEqual([{ data: "hello" }]);
  });

  it("supports multiple handlers for the same event", async () => {
    const { ch } = await joinedChannel();
    const a: unknown[] = [];
    const b: unknown[] = [];
    ch.on("evt", (p) => a.push(p));
    ch.on("evt", (p) => b.push(p));
    ch.onMessage(null, null, "evt", { n: 1 });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("unsubscribe removes only the specific handler", async () => {
    const { ch } = await joinedChannel();
    const a: unknown[] = [];
    const b: unknown[] = [];
    const unsub = ch.on("evt", (p) => a.push(p));
    ch.on("evt", (p) => b.push(p));
    unsub();
    ch.onMessage(null, null, "evt", { n: 1 });
    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
  });

  it("ignores messages from stale join refs", async () => {
    const { ch } = await joinedChannel();
    const received: unknown[] = [];
    ch.on("evt", (p) => received.push(p));
    ch.onMessage("wrong_ref", null, "evt", { data: "stale" });
    expect(received).toHaveLength(0);
  });

  it("accepts messages with null join ref (broadcasts)", async () => {
    const { ch } = await joinedChannel();
    const received: unknown[] = [];
    ch.on("evt", (p) => received.push(p));
    ch.onMessage(null, null, "evt", { data: "broadcast" });
    expect(received).toEqual([{ data: "broadcast" }]);
  });

  it("handler errors do not crash dispatch", async () => {
    const { ch } = await joinedChannel();
    const received: unknown[] = [];
    ch.on("evt", () => {
      throw new Error("handler crash");
    });
    ch.on("evt", (p) => received.push(p));
    ch.onMessage(null, null, "evt", { data: "test" });
    expect(received).toEqual([{ data: "test" }]);
  });

  it("fires phx_close handlers", async () => {
    const { ch } = await joinedChannel();
    const events: unknown[] = [];
    ch.on("phx_close", (p) => events.push(p));
    ch.onMessage(null, null, "phx_close", {});
    expect(events).toHaveLength(1);
  });

  it("fires phx_error handlers", async () => {
    const { ch } = await joinedChannel();
    const events: unknown[] = [];
    ch.on("phx_error", (p) => events.push(p));
    ch.onMessage(null, null, "phx_error", { reason: "crash" });
    expect(events).toEqual([{ reason: "crash" }]);
  });
});

// ─── Channel push buffering ─────────────────────────────────────

describe("Channel push buffering", () => {
  it("buffers pushes before join and flushes after", async () => {
    const socket = createMockSocket();
    const ch = new Channel(socket as any, "test:topic", {});

    const pushPromise = ch.push("buffered_event", { n: 1 }, 2000);

    const joinPromise = ch.join(undefined, { timeoutMs: 2000 });
    const [joinRef, joinRefVal] = socket.sent[0]!;
    ch.onMessage(joinRef as string, joinRefVal as string, "phx_reply", {
      status: "ok",
      response: {},
    });
    await joinPromise;

    const pushMsg = socket.sent.find((m) => m[3] === "buffered_event");
    expect(pushMsg).toBeDefined();

    ch.onMessage(pushMsg![0] as string, pushMsg![1] as string, "phx_reply", {
      status: "ok",
      response: { buffered: true },
    });

    const result = await pushPromise;
    expect(result).toEqual({ status: "ok", response: { buffered: true } });
  });

  it("buffered push preserves caller's custom timeout after flush", async () => {
    // Use a mock socket with a SHORT default timeout
    const socket = createMockSocket();
    socket.timeoutMs = 100;
    const ch = new Channel(socket as any, "test:topic", {});

    // Buffer a push with a LONG custom timeout (500ms)
    const pushPromise = ch.push("custom_timeout", { n: 1 }, 500);

    // Join quickly
    const joinPromise = ch.join(undefined, { timeoutMs: 2000 });
    const [joinRef, joinRefVal] = socket.sent[0]!;
    ch.onMessage(joinRef as string, joinRefVal as string, "phx_reply", {
      status: "ok",
      response: {},
    });
    await joinPromise;

    // Wait longer than the socket default (100ms) but shorter than the custom timeout (500ms).
    // If the bug were present, this would time out at ~100ms using socket.timeoutMs.
    await new Promise((r) => setTimeout(r, 200));

    // The push should still be alive — reply now
    const pushMsg = socket.sent.find((m) => m[3] === "custom_timeout");
    expect(pushMsg).toBeDefined();

    ch.onMessage(pushMsg![0] as string, pushMsg![1] as string, "phx_reply", {
      status: "ok",
      response: { preserved: true },
    });

    const result = await pushPromise;
    expect(result).toEqual({ status: "ok", response: { preserved: true } });
  });

  it("buffered push does not spuriously time out after flush", async () => {
    const socket = createMockSocket();
    const ch = new Channel(socket as any, "test:topic", {});

    // Buffer a push with a 500ms timeout.
    // The OLD bug: the buffer timeout fires at 500ms, but after flush,
    // doPush would use socket.timeoutMs (1000ms) — meaning the original
    // buffer timer could reject before doPush's timer.
    // The FIX: flushPushBuffer clears the buffer timer and doPush uses
    // the caller's 500ms, so the reply at 200ms is well within bounds.
    const pushPromise = ch.push("slow_buf", { n: 1 }, 500);

    // Join quickly
    const joinPromise = ch.join(undefined, { timeoutMs: 2000 });
    const [joinRef, joinRefVal] = socket.sent[0]!;
    ch.onMessage(joinRef as string, joinRefVal as string, "phx_reply", {
      status: "ok",
      response: {},
    });
    await joinPromise;

    // Wait 200ms — well under the 500ms timeout
    await new Promise((r) => setTimeout(r, 200));

    // Reply — should resolve successfully
    const pushMsg = socket.sent.find((m) => m[3] === "slow_buf");
    expect(pushMsg).toBeDefined();

    ch.onMessage(pushMsg![0] as string, pushMsg![1] as string, "phx_reply", {
      status: "ok",
      response: { survived: true },
    });

    const result = await pushPromise;
    expect(result).toEqual({ status: "ok", response: { survived: true } });
  });
});

// ─── Channel leave ──────────────────────────────────────────────

describe("Channel leave", () => {
  it("sends phx_leave and transitions to closed", async () => {
    const { socket, ch } = await joinedChannel();
    const leavePromise = ch.leave(500);

    const leaveMsg = socket.sent.find((m) => m[3] === "phx_leave");
    expect(leaveMsg).toBeDefined();

    ch.onMessage(leaveMsg![0] as string, leaveMsg![1] as string, "phx_reply", {
      status: "ok",
      response: {},
    });

    await leavePromise;
    expect(ch.state).toBe("closed");
  });

  it("leave on closed channel is a no-op", async () => {
    const socket = createMockSocket();
    const ch = new Channel(socket as any, "test:topic", {});
    await ch.leave(500);
    expect(socket.sent).toHaveLength(0);
  });

  it("leave times out gracefully without throwing", async () => {
    const { ch } = await joinedChannel();
    await ch.leave(50);
    expect(ch.state).toBe("closed");
  });
});

// ─── Channel rejoin ─────────────────────────────────────────────

describe("Channel rejoin", () => {
  it("resets state and re-joins", async () => {
    const { socket, ch } = await joinedChannel();
    expect(ch.isJoined).toBe(true);

    const rejoinPromise = ch.rejoin();
    const joinMsg = socket.sent.find((m) => m[3] === "phx_join");
    expect(joinMsg).toBeDefined();

    ch.onMessage(joinMsg![0] as string, joinMsg![1] as string, "phx_reply", {
      status: "ok",
      response: { rejoined: true },
    });

    await rejoinPromise;
    expect(ch.isJoined).toBe(true);
  });

  it("rejoin on closed channel is a no-op", async () => {
    const socket = createMockSocket();
    const ch = new Channel(socket as any, "test:topic", {});
    await ch.rejoin();
    expect(socket.sent).toHaveLength(0);
  });

  it("sets errored state if rejoin fails", async () => {
    const { socket, ch } = await joinedChannel();

    const rejoinPromise = ch.rejoin();
    const joinMsg = socket.sent.find((m) => m[3] === "phx_join");

    ch.onMessage(joinMsg![0] as string, joinMsg![1] as string, "phx_reply", {
      status: "error",
      response: { reason: "gone" },
    });

    await rejoinPromise;
    expect(ch.state).toBe("errored");
  });
});
