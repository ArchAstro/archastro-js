# @archastro/sdk

TypeScript SDK for the ArchAstro Platform API.

## Documentation

API reference documentation is published at
[archastro.github.io/archastro-js](https://archastro.github.io/archastro-js/).

Use this site in two layers:

- Start with the guides when you are wiring the SDK into an app, worker, or
  internal tool.
- Use the API reference when you know the resource or method you need.

## Install

```sh
npm install @archastro/sdk
```

## Choose An Auth Mode

Most app integrations use a publishable API key plus a user access token:

```ts
import { PlatformClient } from "@archastro/sdk";

const client = PlatformClient.withToken(
  process.env.ARCHASTRO_API_KEY ?? "",
  process.env.ARCHASTRO_ACCESS_TOKEN ?? "",
);
```

Server-side org bots and workers can also use an app-scoped user token directly:

```ts
const client = new PlatformClient({
  accessToken: process.env.ARCHASTRO_ACCESS_TOKEN,
});
```

Set `baseUrl` only for local development or staging:

```ts
import { PlatformClient } from "@archastro/sdk";

const client = PlatformClient.withToken(
  process.env.ARCHASTRO_API_KEY ?? "",
  process.env.ARCHASTRO_ACCESS_TOKEN ?? "",
  process.env.ARCHASTRO_PLATFORM_BASE_URL,
);
```

## Quickstart

```ts
const me = await client.users.me();
const teams = await client.teams.list();

console.log(me.id, me.email, teams);
```

## React Native / Expo

Native mobile works out of the box — no Node `ws` / `events` polyfills:

```ts
import {
  createSessionClient,
  createPlatformSocket,
  ApiChatChannel,
} from "@archastro/sdk";
```

Use `createSessionClient` with SecureStore/AsyncStorage, passwordless OTP via
`sessionClient.passwordless`, REST via `sessionClient.client`, and realtime via
`createPlatformSocket` + `ApiChatChannel`. See
[React Native guide](./docs/react-native.md).

## Integration Guides

- [Authentication](./docs/authentication.md): choose the right token strategy for
  browser sessions, server-side app integrations, and org workers.
- [React Native / Expo](./docs/react-native.md): session storage, passwordless
  auth, and chat channels without Node polyfills.
- [Integration scenarios](./docs/scenarios.md): read the current user, list
  teams, and create an agent with snippets that were smoke-tested against the
  local platform dev harness.

## Common Resource Pattern

Resources hang directly off `PlatformClient` and under `client.v1`:

```ts
await client.agents.list();
await client.agents.create({
  name: "Support triage",
  identity: "You triage support requests and keep replies concise.",
});
```

The generated API surface includes typed REST resources, auth helpers, and
channel clients. The lower-level Phoenix Channel client is documented in
[`src/phx_channel/README.md`](./src/phx_channel/README.md).
