# ArchAstro Developer Platform - JS SDK

[![CI](https://github.com/archastro/archastro-js/actions/workflows/ci.yml/badge.svg)](https://github.com/archastro/archastro-js/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@archastro/sdk)](https://www.npmjs.com/package/@archastro/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

TypeScript SDK for the [ArchAstro Platform API](https://platform.archastro.ai). Provides typed access to all platform resources, authentication helpers, and real-time Phoenix Channel support.

## Installation

```bash
npm install @archastro/sdk
```

Requires Node.js 22 or later. The package is pure ESM.

## Quick start

### Secret key (server-side)

```typescript
import { PlatformClient } from "@archastro/sdk";

const client = PlatformClient.withSecretKey("sk_live_...");

const agents = await client.agents.list();
const thread = await client.threads.get("thread_abc123");
```

### Access token (client-side)

```typescript
const client = PlatformClient.withToken("pk_live_...", accessToken);

const me = await client.users.me();
```

### Email / password login

```typescript
const client = await PlatformClient.withCredentials(
  "pk_live_...",
  "user@example.com",
  "password",
);

// Automatic 401 refresh is wired up for you
const teams = await client.teams.list();
```

## Authentication

`PlatformClient` supports three authentication modes:

| Factory method | Use case | Headers |
| --- | --- | --- |
| `withSecretKey(key)` | Server-side admin access | `x-archastro-api-key` |
| `withToken(apiKey, accessToken)` | Pre-authenticated user | `x-archastro-api-key` + `Authorization: Bearer` |
| `withCredentials(apiKey, email, password)` | Login with auto-refresh | `x-archastro-api-key` + `Authorization: Bearer` |

All factory methods accept an optional `baseUrl` parameter (defaults to `https://platform.archastro.ai`).

When using `withCredentials`, expired tokens are automatically refreshed on 401 responses. Concurrent requests that encounter a 401 share a single refresh call.

## Resources

All resources are accessible directly on the client instance and under `client.v1`:

```typescript
client.agents              // AgentResource
client.agent_computers     // AgentComputerResource
client.agent_installations // AgentInstallationResource
client.agent_routines      // AgentRoutineResource
client.agent_sessions      // AgentSessionResource
client.agent_skills        // AgentSkillResource
client.agent_tools         // AgentToolResource
client.ai                  // AiResource
client.artifacts           // ArtifactResource
client.automation_runs     // AutomationRunResource
client.automations         // AutomationResource
client.config              // ConfigResource
client.custom_objects      // CustomObjectResource
client.installation_sources // InstallationSourceResource
client.orgs                // OrgResource
client.team_memberships    // TeamMembershipResource
client.teams               // TeamResource
client.thread_messages     // ThreadMessageResource
client.threads             // ThreadResource
client.users               // UserResource
```

Each resource provides typed methods for `list`, `get`, `create`, `update`, `delete`, and any resource-specific operations.

## Real-time channels

The SDK includes Phoenix Channel wrappers for real-time features:

- **`ApiChatChannel`** - Real-time chat messaging with team-scoped and user-scoped threads
- **`ApiActivityFeedChannel`** - Live activity feeds for agents and organizations
- **`ApiObjectChannel`** - Collaborative real-time object editing

These are built on a bundled Phoenix Channel client that implements the [Phoenix v2.0.0 wire protocol](./src/phx_channel/README.md) over WebSocket with auto-reconnect, heartbeat, and push buffering.

## Error handling

API errors are thrown as `ApiError` instances:

```typescript
import { PlatformClient } from "@archastro/sdk";

try {
  await client.agents.get("nonexistent");
} catch (err) {
  if (err instanceof Error && "status" in err) {
    console.error(err.status);    // HTTP status code
    console.error(err.message);   // Error message
    console.error(err.errorCode); // Platform error code
  }
}
```

## Development

```bash
# Install dependencies
npm ci

# Type check
npx tsc --noEmit

# Run unit tests
npm test

# Run contract tests (starts a Prism mock server against the OpenAPI spec)
npm run test:contract

# Build
npm run build
```

### Project structure

```
src/
  index.ts              # Package entry point
  client.ts             # PlatformClient with factory constructors
  auth.ts               # AuthClient (login, refresh, token exchange)
  v1.ts                 # V1 namespace
  v1/resources/         # Auto-generated resource classes
  types/                # Auto-generated TypeScript types
  channels/             # Auto-generated Phoenix Channel wrappers
  runtime/http-client.ts  # Hand-maintained HTTP client
  phx_channel/          # Hand-maintained Phoenix Channel client
specs/
  platform-openapi.json # OpenAPI spec (source for codegen)
__tests__/
  http-client.test.ts   # Unit tests
  contract/             # Auto-generated contract tests (Prism)
```

Most of the SDK is auto-generated from the OpenAPI spec by `@archastro/sdk-generator`. Files marked with a `Content hash` comment header should not be edited by hand. Hand-maintained files include `src/runtime/http-client.ts` and the `src/phx_channel/` directory.

## License

[MIT](./LICENSE) - Copyright (c) 2026 ArchAstro Inc.
