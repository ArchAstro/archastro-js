---
title: Authentication
group: Guides
---

# Authentication

`@archastro/sdk` supports four auth shapes. Pick the one that matches who the
process is acting as.

## Mobile / SPA durable user session

Use this for React Native or browser apps that sign users in (passwordless OTP
or other flows) and need access tokens to auto-refresh across restarts.

```ts
import { PlatformClient, type SessionStorage } from "@archastro/sdk";

const client = PlatformClient.forApp({
  publishableKey: process.env.ARCHASTRO_PUBLISHABLE_KEY ?? "",
  baseUrl: process.env.ARCHASTRO_PLATFORM_BASE_URL, // optional
  storage, // your SecureStore / AsyncStorage adapter
});

await client.restore();
// login → client.passwordless… → client.signIn(tokens, user)
const me = await client.users.me();
```

On 401 the client exchanges the refresh token via `POST /api/v1/auth/refresh`,
updates storage, and retries. See [React Native](./react-native.md).

## Static user access token

Use this when a user has already signed in elsewhere and your code only has a
publishable API key plus a short-lived access token (no durable refresh).

```ts
import { PlatformClient } from "@archastro/sdk";

const client = PlatformClient.withToken(
  process.env.ARCHASTRO_API_KEY ?? "",
  process.env.ARCHASTRO_ACCESS_TOKEN ?? "",
);

const me = await client.users.me();
console.log(me.id, me.email);
```

## Org bot or worker

Use this when a backend process should act as an org-owned system user. The
token should be an app-scoped user token created for that bot or worker.

```ts
import { PlatformClient } from "@archastro/sdk";

const client = new PlatformClient({
  accessToken: process.env.ARCHASTRO_ACCESS_TOKEN,
});

const me = await client.users.me();
console.log(me.id);
```

## Email/password (scripts)

```ts
const client = await PlatformClient.withCredentials(
  publishableKey,
  email,
  password,
  baseUrl,
);
```

Wires in-memory refresh only — tokens are not persisted. Prefer `forApp` for
long-lived clients.

## Local or staging targets

The SDK defaults to `https://platform.archastro.ai`. Override `baseUrl` only
when targeting local development, staging, or another non-production gateway.

```ts
const client = PlatformClient.forApp({
  publishableKey: process.env.ARCHASTRO_PUBLISHABLE_KEY ?? "",
  baseUrl: process.env.ARCHASTRO_PLATFORM_BASE_URL,
  storage,
});
```
