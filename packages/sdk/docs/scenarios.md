---
title: Integration Scenarios
group: Guides
---

# Integration Scenarios

These examples show the SDK shape for common integrations. They were smoke-tested
against the local platform dev harness with org-user tokens.

## Read The Current User

Use `users.me()` to validate that a token is usable and to discover the current
actor.

```ts
import { PlatformClient } from "@archastro/sdk";

const client = PlatformClient.withToken(
  process.env.ARCHASTRO_API_KEY ?? "",
  process.env.ARCHASTRO_ACCESS_TOKEN ?? "",
);

const me = await client.users.me();
console.log(me.id, me.email);
```

## List Teams

Use resource collections directly from the client. List responses are typed and
follow the API response shape for that resource.

```ts
const teams = await client.teams.list();
console.log(teams);
```

## Create An Agent

Use `agents.create()` to provision an agent owned by the current user, org, or
team context. Store the returned `id` if you need to fetch or update it later.

```ts
const agent = await client.agents.create({
  name: "Support triage",
  identity: "You triage support requests and keep replies concise.",
});

console.log(agent.id, agent.name);
```

For cleanup in tests and scripts:

```ts
await client.agents.delete(agent.id);
```

