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

## Session + passwordless auth

Provide your own storage (Expo SecureStore or AsyncStorage) and a publishable
key:

```ts
import {
  createSessionClient,
  createPlatformSocket,
  ApiChatChannel,
  type SessionStorage,
  type StoredSession,
} from "@archastro/sdk";
import * as SecureStore from "expo-secure-store";

const storage: SessionStorage = {
  async load() {
    const raw = await SecureStore.getItemAsync("archastro_session");
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  },
  async save(session) {
    await SecureStore.setItemAsync("archastro_session", JSON.stringify(session));
  },
  async clear() {
    await SecureStore.deleteItemAsync("archastro_session");
  },
};

const sessionClient = createSessionClient({
  baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL!,
  publishableKey: process.env.EXPO_PUBLIC_PUBLISHABLE_KEY!,
  storage,
});

await sessionClient.restore();

// Passwordless OTP
await sessionClient.passwordless.register({
  email: "you@company.com",
  full_name: "You",
  alias: "you",
});
// or requestLoginCode on existing accounts

const { tokens, user } = await sessionClient.passwordless.verifyCode({
  email: "you@company.com",
  code: "123456",
});
await sessionClient.establish(tokens, user as StoredSession["user"]);

// Typed REST
const me = await sessionClient.client.users.me();
const agents = await sessionClient.client.agents.list();
```

## Realtime chat

```ts
const session = sessionClient.getSession();
const socket = createPlatformSocket({
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL!,
  accessToken: session!.accessToken,
  publishableKey: process.env.EXPO_PUBLIC_PUBLISHABLE_KEY,
});
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
