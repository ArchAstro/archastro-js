/**
 * Integration tests for the TypeScript Phoenix Channel client.
 *
 * These run against the same Elixir test server used by the Python phx-channel tests.
 * Start the server before running: cd src/python/phx-channel/test_server && PORT=4855 mix phx.server
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Socket, Channel, ChannelError } from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_SERVER_DIR = resolve(
  __dirname,
  "../../../../../elixir/test/channel_test_server"
);
const PORT = 4856; // different port from Python tests to avoid conflicts
const SOCKET_URL = `ws://localhost:${PORT}/socket/websocket`;

let serverProcess: ChildProcess;

beforeAll(async () => {
  // Start the Elixir test server
  serverProcess = spawn("mix", ["phx.server"], {
    cwd: TEST_SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      PHX_SERVER: "true",
      SECRET_KEY_BASE:
        "test_secret_key_base_that_is_at_least_64_bytes_long_for_phoenix_to_accept_it",
      MIX_ENV: "dev",
    },
    stdio: "pipe",
  });

  // Wait for server to be ready
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`).catch(() => null);
      if (res) break;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}, 35000);

afterAll(() => {
  if (serverProcess?.pid) {
    try {
      process.kill(-serverProcess.pid, "SIGTERM");
    } catch {
      serverProcess.kill("SIGTERM");
    }
  }
});

// ─── Connection ──────────────────────────────────────────────────

describe("Connection", () => {
  it("connects and disconnects", async () => {
    const socket = new Socket(SOCKET_URL);
    await socket.connect();
    expect(socket.isConnected).toBe(true);
    await socket.disconnect();
    expect(socket.isConnected).toBe(false);
  });

  it("connects with params", async () => {
    const socket = new Socket(SOCKET_URL, {
      params: { token: "valid_token" },
    });
    await socket.connect();
    expect(socket.isConnected).toBe(true);
    await socket.disconnect();
  });
});

// ─── Join ────────────────────────────────────────────────────────

describe("Join", () => {
  it("joins a channel and gets response", async () => {
    const socket = new Socket(SOCKET_URL);
    await socket.connect();
    try {
      const channel = socket.channel("test:lobby");
      const resp = await channel.join();
      expect(resp.message).toBe("welcome to lobby");
      expect(channel.isJoined).toBe(true);
    } finally {
      await socket.disconnect();
    }
  });

  it("joins with params", async () => {
    const socket = new Socket(SOCKET_URL);
    await socket.connect();
    try {
      const channel = socket.channel("test:params", {
        key: "value",
        n: 42,
      });
      const resp = await channel.join();
      expect(resp.received_params).toEqual({ key: "value", n: 42 });
    } finally {
      await socket.disconnect();
    }
  });

  it("rejects join with error", async () => {
    const socket = new Socket(SOCKET_URL);
    await socket.connect();
    try {
      const channel = socket.channel("test:reject");
      await expect(channel.join()).rejects.toThrow(ChannelError);
      await expect(channel.join()).rejects.toThrow("not allowed");
    } finally {
      await socket.disconnect();
    }
  });
});

// ─── Push / Reply ────────────────────────────────────────────────

describe("Push / Reply", () => {
  it("echoes payload back", async () => {
    const socket = new Socket(SOCKET_URL);
    await socket.connect();
    try {
      const channel = socket.channel("test:lobby");
      await channel.join();

      const result = (await channel.push("echo", {
        hello: "world",
      })) as Record<string, unknown>;
      expect(result).toEqual({
        status: "ok",
        response: { hello: "world" },
      });
    } finally {
      await socket.disconnect();
    }
  });

  it("returns error reply", async () => {
    const socket = new Socket(SOCKET_URL);
    await socket.connect();
    try {
      const channel = socket.channel("test:lobby");
      await channel.join();

      const result = (await channel.push("echo_error")) as Record<
        string,
        unknown
      >;
      expect(result).toEqual({
        status: "error",
        response: { reason: "something went wrong" },
      });
    } finally {
      await socket.disconnect();
    }
  });

  it("times out on slow reply", async () => {
    const socket = new Socket(SOCKET_URL);
    await socket.connect();
    try {
      const channel = socket.channel("test:lobby");
      await channel.join();

      await expect(
        channel.push("delayed_reply", { delay_ms: 3000 }, 1000)
      ).rejects.toThrow("timed out");
    } finally {
      await socket.disconnect();
    }
  });
});

// ─── Server Push Events ─────────────────────────────────────────

describe("Server Push Events", () => {
  it("receives server push events", async () => {
    const socket = new Socket(SOCKET_URL);
    await socket.connect();
    try {
      const channel = socket.channel("test:lobby");
      await channel.join();

      const received: unknown[] = [];
      channel.on("server_push", (payload) => received.push(payload));

      await channel.push("push_from_server", { data: "test_value" });
      await new Promise((r) => setTimeout(r, 100));

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ data: "test_value" });
    } finally {
      await socket.disconnect();
    }
  });

  it("receives broadcast events", async () => {
    const socket = new Socket(SOCKET_URL);
    await socket.connect();
    try {
      const channel = socket.channel("test:lobby");
      await channel.join();

      const received: unknown[] = [];
      channel.on("broadcast_event", (payload) => received.push(payload));

      await channel.push("broadcast", { msg: "hello all" });
      await new Promise((r) => setTimeout(r, 100));

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ msg: "hello all" });
    } finally {
      await socket.disconnect();
    }
  });

  it("unsubscribes from events", async () => {
    const socket = new Socket(SOCKET_URL);
    await socket.connect();
    try {
      const channel = socket.channel("test:lobby");
      await channel.join();

      const received: unknown[] = [];
      const unsub = channel.on("server_push", (payload) =>
        received.push(payload)
      );

      await channel.push("push_from_server", { n: 1 });
      await new Promise((r) => setTimeout(r, 100));
      expect(received).toHaveLength(1);

      unsub();

      await channel.push("push_from_server", { n: 2 });
      await new Promise((r) => setTimeout(r, 100));
      expect(received).toHaveLength(1); // No new events
    } finally {
      await socket.disconnect();
    }
  });
});

// ─── Leave ──────────────────────────────────────────────────────

describe("Leave", () => {
  it("leaves a channel", async () => {
    const socket = new Socket(SOCKET_URL);
    await socket.connect();
    try {
      const channel = socket.channel("test:lobby");
      await channel.join();
      expect(channel.isJoined).toBe(true);

      await channel.leave();
      expect(channel.state).toBe("closed");
    } finally {
      await socket.disconnect();
    }
  });
});

// ─── Auth ───────────────────────────────────────────────────────

describe("Auth", () => {
  it("authenticates with token", async () => {
    const socket = new Socket(SOCKET_URL, {
      params: { token: "valid_token" },
    });
    await socket.connect();
    try {
      const channel = socket.channel("auth:protected");
      const resp = await channel.join();
      expect(resp.user_id).toBe("user_123");

      const result = (await channel.push("whoami")) as {
        status: string;
        response: { user_id: string };
      };
      expect(result.status).toBe("ok");
      expect(result.response.user_id).toBe("user_123");
    } finally {
      await socket.disconnect();
    }
  });

  it("rejects auth without token", async () => {
    const socket = new Socket(SOCKET_URL);
    await socket.connect();
    try {
      const channel = socket.channel("auth:protected");
      await expect(channel.join()).rejects.toThrow("unauthorized");
    } finally {
      await socket.disconnect();
    }
  });
});

// ─── Multiple Channels ─────────────────────────────────────────

describe("Multiple Channels", () => {
  it("supports multiple channels on one socket", async () => {
    const socket = new Socket(SOCKET_URL);
    await socket.connect();
    try {
      const ch1 = socket.channel("test:room_a");
      const ch2 = socket.channel("test:room_b");

      await ch1.join();
      await ch2.join();

      const r1 = (await ch1.push("echo", { from: "a" })) as {
        response: { from: string };
      };
      const r2 = (await ch2.push("echo", { from: "b" })) as {
        response: { from: string };
      };

      expect(r1.response.from).toBe("a");
      expect(r2.response.from).toBe("b");
    } finally {
      await socket.disconnect();
    }
  });
});

// ─── Heartbeat ──────────────────────────────────────────────────

describe("Heartbeat", () => {
  it("keeps connection alive across heartbeats", async () => {
    const socket = new Socket(SOCKET_URL, {
      heartbeatIntervalMs: 1000,
    });
    await socket.connect();
    try {
      const channel = socket.channel("test:lobby");
      await channel.join();

      // Wait for multiple heartbeats
      await new Promise((r) => setTimeout(r, 3000));

      expect(socket.isConnected).toBe(true);
      expect(channel.isJoined).toBe(true);

      const result = (await channel.push("echo", { alive: true })) as {
        status: string;
      };
      expect(result.status).toBe("ok");
    } finally {
      await socket.disconnect();
    }
  });
});

// ─── Autonomous Receive (Server Ticker) ─────────────────────────

describe("Autonomous Receive", () => {
  it("receives a stream of server-pushed tick events", async () => {
    const socket = new Socket(SOCKET_URL);
    await socket.connect();
    try {
      const channel = socket.channel("test:lobby");
      await channel.join();

      const ticks: unknown[] = [];
      let done = false;
      channel.on("tick", (payload) => ticks.push(payload));
      channel.on("tick_done", () => {
        done = true;
      });

      // Ask server to send 5 ticks at 100ms intervals
      await channel.push("start_ticker", {
        interval_ms: 100,
        count: 5,
      });

      // Wait for all ticks + done signal (5 * 100ms + buffer)
      await new Promise((r) => setTimeout(r, 1500));

      expect(done).toBe(true);
      expect(ticks).toHaveLength(5);
      // Verify sequence numbers
      expect(ticks.map((t: any) => t.seq)).toEqual([0, 1, 2, 3, 4]);
    } finally {
      await socket.disconnect();
    }
  });

  it("can stop the ticker mid-stream", async () => {
    const socket = new Socket(SOCKET_URL);
    await socket.connect();
    try {
      const channel = socket.channel("test:lobby");
      await channel.join();

      const ticks: unknown[] = [];
      channel.on("tick", (payload) => ticks.push(payload));

      // Start 20 ticks at 100ms intervals
      await channel.push("start_ticker", {
        interval_ms: 100,
        count: 20,
      });

      // Wait for a few ticks then stop
      await new Promise((r) => setTimeout(r, 350));
      await channel.push("stop_ticker");

      const countAtStop = ticks.length;

      // Wait to confirm no more arrive
      await new Promise((r) => setTimeout(r, 500));

      expect(ticks.length).toBe(countAtStop);
      expect(countAtStop).toBeGreaterThan(0);
      expect(countAtStop).toBeLessThan(20);
    } finally {
      await socket.disconnect();
    }
  });
});
