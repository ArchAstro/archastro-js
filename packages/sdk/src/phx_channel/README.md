# @archastro/phx-channel

Pure TypeScript client for [Phoenix Channels](https://hexdocs.pm/phoenix/channels.html). No dependency on the official `phoenix` npm package — implements the wire protocol directly over WebSocket.

Works in Node.js (via `ws`) and browsers (via native `WebSocket`).

## Install

```bash
npm install @archastro/phx-channel
```

## Quick Start

```typescript
import { Socket } from "@archastro/phx-channel";

const socket = new Socket("ws://localhost:4000/socket/websocket", {
  params: { token: "user-jwt-token" },
});

await socket.connect();

const channel = socket.channel("room:lobby", { user_id: "123" });
const response = await channel.join();
console.log("Joined:", response);

// Send a message and wait for the reply
const reply = await channel.push("new_msg", { body: "hello" });
console.log("Reply:", reply);

// Listen for server-pushed events
const unsub = channel.on("new_msg", (payload) => {
  console.log("New message:", payload);
});

// Unsubscribe when done
unsub();

// Leave and disconnect
await channel.leave();
await socket.disconnect();
```

## API

### `Socket`

Manages the WebSocket connection, heartbeat, and channel multiplexing.

#### `new Socket(url, config?)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string` | WebSocket URL (e.g., `ws://localhost:4000/socket/websocket`) |
| `config.params` | `Record<string, string>` | Query params appended to the URL (e.g., `{ token, api_key }`) |
| `config.heartbeatIntervalMs` | `number` | Heartbeat interval in ms (default `30000`) |
| `config.timeoutMs` | `number` | Default timeout for join/push operations in ms (default `10000`) |
| `config.reconnectBackoffMs` | `number[]` | Backoff schedule in ms (default `[10, 50, 100, 150, 200, 250, 500, 1000, 2000]`) |
| `config.autoReconnect` | `boolean` | Auto-reconnect on disconnect (default `true`) |

#### `socket.connect(): Promise<void>`

Connect to the server. Resolves when the WebSocket is open. If `autoReconnect` is enabled and the connection fails, retries with exponential backoff.

#### `socket.disconnect(): Promise<void>`

Gracefully close the connection. Stops heartbeat and receive loops.

#### `socket.isConnected: boolean`

Whether the socket is currently connected.

#### `socket.channel(topic, params?): Channel`

Create (or retrieve) a channel for the given topic. The channel is not joined until you call `channel.join()`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `topic` | `string` | Channel topic (e.g., `"room:lobby"`, `"api:object:123"`) |
| `params` | `Record<string, unknown>` | Join params sent to the server |

Returns the same `Channel` instance if called again with the same topic.

#### `socket.onEvent(listener): () => void`

Subscribe to socket-level events. Returns an unsubscribe function.

```typescript
socket.onEvent((event) => {
  switch (event.type) {
    case "open": // connected
    case "close": // disconnected, event.code + event.reason
    case "error": // connection error, event.error
  }
});
```

---

### `Channel`

Manages a single topic subscription with join/leave lifecycle, push/reply matching, and event handlers.

#### `channel.join(timeoutMs?): Promise<Record<string, unknown>>`

Join the channel. Returns the server's join response payload. Throws `ChannelError` if the server rejects the join or on timeout.

```typescript
const response = await channel.join();
// response = { user_count: 5 } (whatever the server returns)
```

#### `channel.leave(timeoutMs?): Promise<void>`

Leave the channel. Best-effort — does not throw on timeout.

#### `channel.push(event, payload?, timeoutMs?): Promise<unknown>`

Send an event to the server and wait for a reply. Returns the reply payload (`{ status, response }`). Throws `ChannelError` on timeout.

```typescript
const reply = await channel.push("new_msg", { body: "hello" });
// reply = { status: "ok", response: { id: "msg_123" } }
```

If the channel is not yet joined, the push is buffered and sent after join succeeds.

| Parameter | Type | Description |
|-----------|------|-------------|
| `event` | `string` | Event name |
| `payload` | `unknown` | Event payload (default `{}`) |
| `timeoutMs` | `number` | Override default timeout |

#### `channel.on(event, callback): () => void`

Register a callback for server-pushed events. Returns an unsubscribe function.

```typescript
const unsub = channel.on("new_msg", (payload) => {
  console.log(payload); // { user: "alice", body: "hi" }
});

// Later:
unsub();
```

#### `channel.state: string`

Current channel state: `"closed"` | `"joining"` | `"joined"` | `"leaving"` | `"errored"`.

#### `channel.isJoined: boolean`

Whether the channel is currently in the `"joined"` state.

---

### `ChannelError`

Thrown when a channel operation fails (join rejected, push timeout, etc.).

```typescript
import { ChannelError } from "@archastro/phx-channel";

try {
  await channel.join();
} catch (err) {
  if (err instanceof ChannelError) {
    console.error(err.message); // "Join rejected for room:secret: {"reason":"unauthorized"}"
  }
}
```

## Wire Protocol

This client implements Phoenix Channel protocol v2.0.0. Messages are JSON arrays sent as WebSocket text frames:

```
[join_ref, ref, topic, event, payload]
```

| Field | Type | Description |
|-------|------|-------------|
| `join_ref` | `string \| null` | Reference from the channel's join message |
| `ref` | `string \| null` | Unique request reference for push/reply matching |
| `topic` | `string` | Channel topic |
| `event` | `string` | Event name (`phx_join`, `phx_leave`, `phx_reply`, or custom) |
| `payload` | `object` | Event data |

Heartbeats are sent every 30s on topic `"phoenix"` with event `"heartbeat"`. If the server doesn't reply within one interval, the connection is closed and reconnection is scheduled.

## Authentication

Pass auth tokens as query params — they're appended to the WebSocket URL during connection:

```typescript
const socket = new Socket("ws://localhost:4000/socket/websocket", {
  params: {
    token: "user-jwt-token",
    api_key: "pk_...",
  },
});
```

The server receives these in the `connect/3` callback's params map.
