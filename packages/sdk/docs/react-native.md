---
title: React Native
group: Guides
---

# React Native / Expo

`@archastro/sdk` works in React Native and Expo without Node polyfills
(`events`, `ws`, etc.). The package ships a Metro-resolved native entry and a
`.native` WebSocket factory that uses the global `WebSocket` only.

## Install

```sh
npm install @archastro/sdk
```

`zod` is a normal dependency and is resolved by Metro from the package. The
optional `ws` package is **Node-only** and is not required in RN (Metro loads
`phx_channel/websocket.native.js` instead).

## One client: `PlatformClient.forApp`

Provide durable storage (Expo SecureStore or AsyncStorage) and a publishable
key. Session lifecycle, passwordless OTP, auto-refresh, and REST all live on
the same `PlatformClient` instance:

```ts
import {
  PlatformClient,
  ApiChatChannel,
  type SessionStorage,
  type AppSession,
} from "@archastro/sdk";
import * as SecureStore from "expo-secure-store";

// Only SessionStorage is a public type you implement — OTP, refresh, and
// sockets are methods on the client returned by forApp.
const storage: SessionStorage = {
  async load() {
    const raw = await SecureStore.getItemAsync("archastro_session");
    return raw ? (JSON.parse(raw) as AppSession) : null;
  },
  async save(session) {
    await SecureStore.setItemAsync("archastro_session", JSON.stringify(session));
  },
  async clear() {
    await SecureStore.deleteItemAsync("archastro_session");
  },
};

const client = PlatformClient.forApp({
  baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL!,
  publishableKey: process.env.EXPO_PUBLIC_PUBLISHABLE_KEY!,
  storage,
});

await client.restore();

// Passwordless OTP (behind the client — not a free-standing auth class)
await client.passwordless.register({
  email: "you@company.com",
  full_name: "You",
  alias: "you",
});
// or requestLoginCode on existing accounts

const { tokens, user } = await client.passwordless.verifyCode({
  email: "you@company.com",
  code: "123456",
});
await client.signIn(tokens, user as AppSession["user"]);

// Typed REST — 401 auto-refreshes using the stored refresh token
const me = await client.users.me();
const agents = await client.agents.list();
```

## Realtime chat

```ts
const socket = client.createSocket(); // uses current access token + publishable key
await socket.connect();

const channel = await ApiChatChannel.joinUserThread(socket, threadId, {
  limit: 50,
});
await channel.apiChatPostMessage({ content: "Hello" });
```

## What the SDK needs from RN

| Need | Source |
|---|---|
| HTTP | global `fetch` |
| WebSocket | global `WebSocket` |
| Token persistence | your `SessionStorage` |
| API base URL | e.g. `http://localhost:4005` (sim) or production |
| Publishable key | `x-archastro-api-key` header |

## Local monorepo (file: link)

When developing against a local `archastro-js` checkout:

```json
"@archastro/sdk": "file:../../../archastro-js/packages/sdk"
```

Point Metro `watchFolders` at the SDK package and rebuild after SDK changes:

```sh
cd packages/sdk && npm run build
```

## iOS simulator localhost

The iOS simulator can reach the host via `http://localhost:PORT`. Physical
devices need your machine LAN IP instead.
