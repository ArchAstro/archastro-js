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

## Analytics

Use `withAnalytics()` when a browser or app needs first-party analytics. The
analytics client owns the `aa_anon_id` cookie, writes it with the same HTTPS and
subdomain behavior as the established web SDK, tracks events through
`POST /api/v1/t`, and links pre-login visitors to signed-in users through
`POST /api/v1/i`.

```ts
import {
  PlatformClient,
  safeBrowserAnalyticsProperties,
  withAnalytics,
} from "@archastro/sdk";

const AnalyticsPlatformClient = PlatformClient.extend(withAnalytics());
const client = new AnalyticsPlatformClient({
  baseUrl: "https://platform.archastro.ai",
  defaultHeaders: { "x-archastro-api-key": publishableKey },
});

await client.analytics.track(
  "page_view",
  {
    ...safeBrowserAnalyticsProperties({ path: "/landing" }),
    source: "landing",
  },
  { keepalive: true },
);

const anonymousId = client.analytics.getAnonymousId();
if (anonymousId) {
  await client.analytics.linkIdentity(anonymousId, user.id);
}
```

`safeBrowserAnalyticsProperties()` emits reduced browser context that is safe to
attach to event properties: the referrer hostname instead of the full referrer
URL and allowlisted UTM query values. It does not include
`window.location.pathname` by default because route segments can contain invite
codes, customer IDs, or other secrets. Pass a classified route template or
static path as `path`; token-like path segments are still redacted unless the
caller passes an already-safe template with `redactPathSegments: false`. Custom
event properties remain caller-owned; do not pass raw URLs, tokens, form values,
or user-authored content unless the receiving product has explicitly classified
that property as safe for analytics.

## React Native / Expo

Native mobile works out of the box — no Node `ws` / `events` polyfills.
Use **`PlatformClient.forApp`** so session storage, passwordless OTP, and
auto-refresh stay behind one client (not a parallel session helper):

```ts
import { PlatformClient, ApiChatChannel, type SessionStorage } from "@archastro/sdk";

const client = PlatformClient.forApp({
  publishableKey: process.env.EXPO_PUBLIC_PUBLISHABLE_KEY!,
  baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL!,
  storage, // your SessionStorage (SecureStore / AsyncStorage)
});

await client.restore();
// client.passwordless… → client.signIn(tokens, user)
await client.agents.list();
const socket = client.createSocket();
```

See [React Native guide](./docs/react-native.md).

## Integration Guides

- [Authentication](./docs/authentication.md): choose the right token strategy for
  browser sessions, server-side app integrations, and org workers.
- [React Native / Expo](./docs/react-native.md): session storage, passwordless
  auth, and chat channels without Node polyfills.
- [Integration scenarios](./docs/scenarios.md): read the current user, list
  teams, and create an agent with snippets that were smoke-tested against the
  local platform dev harness.
- [Custom-object collaboration](./docs/custom-object-collaboration.md): team-owned
  objects, same-origin cookie authentication, realtime snapshots, reconnect
  recovery, presence, and React cleanup.

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
