---
title: Authentication
group: Guides
---

# Authentication

`@archastro/sdk` supports three auth shapes. Pick the one that matches who the
process is acting as.

## User Session In An App

Use this when a user has signed into an ArchAstro-powered application and your
code already has a publishable API key plus the user's access token.

```ts
import { PlatformClient } from "@archastro/sdk";

const client = PlatformClient.withToken(
  process.env.ARCHASTRO_API_KEY ?? "",
  process.env.ARCHASTRO_ACCESS_TOKEN ?? "",
);

const me = await client.users.me();
console.log(me.id, me.email);
```

## Org Bot Or Worker

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

## Local Or Staging Targets

The SDK defaults to `https://platform.archastro.ai`. Override `baseUrl` only
when targeting local development, staging, or another non-production gateway.

```ts
const client = PlatformClient.withToken(
  process.env.ARCHASTRO_API_KEY ?? "",
  process.env.ARCHASTRO_ACCESS_TOKEN ?? "",
  process.env.ARCHASTRO_PLATFORM_BASE_URL,
);
```

