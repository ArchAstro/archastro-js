---
title: Custom-object collaboration
group: Guides
---

# Custom-object collaboration

Custom objects combine persisted JSON fields with a realtime channel. Use nested
maps for independently edited records so one user's change does not replace
another user's unrelated work.

## Same-origin browser client

When a backend owns the platform credential in an HttpOnly session cookie,
construct one client for the authenticated browser session and point both HTTP
and WebSocket traffic at that backend:

```ts
import {
  PlatformClient,
  withCustomObjectSubscriptions,
} from "@archastro/sdk";

const RealtimePlatformClient = PlatformClient.extend(
  withCustomObjectSubscriptions,
);

export const archAstro = new RealtimePlatformClient({
  baseUrl: window.location.origin,
  pathPrefix: "/api/archastro/platform",
  credentials: "include",
});
```

`extend` uses the TypeScript class-expression mixin pattern. It returns a new
client class, so generated resources and static factories remain available and
the compiler infers `customObjectSubscriptions` on its instances. Extensions
can be chained by calling `extend` again on the returned class.

The SDK sends HTTP requests to the configured `pathPrefix`. WebSocket
subscriptions connect to `socketPath`; the browser includes same-origin cookies
during the upgrade. Access and refresh tokens therefore remain unavailable to
browser JavaScript. The backend must authenticate the cookie before proxying
HTTP requests or accepting the WebSocket upgrade.

The extension derives `/api/archastro/platform/socket` from the configured
`pathPrefix`. For a nonstandard route, pass
`customObjectSubscriptionsExtension({ socketPath })` to `extend` instead.

## List and create team-owned objects

App scope comes from the authenticated session, so these calls do not take an
app ID. Team ownership is explicit:

```ts
const page = await archAstro.custom_objects.list({
  type: "archcode-diagram",
  team: [teamId],
  pageSize: 100,
});

const created = await archAstro.custom_objects.create({
  type: "archcode-diagram",
  team: teamId,
  fields: {
    diagram_key: crypto.randomUUID(),
    repository: "firstlanding",
    title: "Request path",
    elements_by_id: {},
    files_by_id: {},
    comments_by_id: {},
    metadata: {},
  },
});
```

## Subscribe, update, save, and close

```ts
import { z } from "zod";
import type {
  CustomObjectConnectionState,
  CustomObjectSubscription,
} from "@archastro/sdk";

const DiagramFields = z.object({
  diagram_key: z.string(),
  repository: z.string(),
  title: z.string(),
  elements_by_id: z.record(z.record(z.unknown())),
  files_by_id: z.record(z.record(z.unknown())),
  comments_by_id: z.record(z.record(z.unknown())),
  metadata: z.record(z.unknown()),
});

type DiagramFields = z.infer<typeof DiagramFields>;

let applyingRemote = false;
let state: CustomObjectConnectionState = "connecting";

const subscription: CustomObjectSubscription<DiagramFields> =
  archAstro.customObjectSubscriptions.subscribe({
    objectId: created.id,
    connectionId: perTabConnectionId,
    fieldsSchema: DiagramFields,

    // Called for the initial join and again after every reconnect. A reconnect
    // snapshot is authoritative and arrives before queued idempotent patches
    // are replayed.
    onSnapshot(snapshot) {
      setReadonly(snapshot.readonly === true);
      applyingRemote = true;
      try {
        replaceMaterializedDocument(snapshot.fields);
      } finally {
        applyingRemote = false;
      }
    },

    // object_updated can contain a partial update or a complete fields map.
    // Compare canonical content before applying it.
    onUpdate(update) {
      if (alreadyMaterialized(update.fields)) return;
      applyingRemote = true;
      try {
        mergeMaterializedDocument(update.fields);
      } finally {
        applyingRemote = false;
      }
    },

    onPresence(collaborator) {
      renderCollaborator(collaborator);
    },

    onPresenceLeave(collaborator) {
      removeCollaborator(collaborator.connectionId);
    },

    onStateChange(nextState) {
      state = nextState;
      renderConnectionState(nextState);
    },

    onError(error) {
      reportCollaborationError(error);
    },
  });

// Nested map assignment: safe to replay because it is idempotent.
await subscription.update({
  elements_by_id: {
    "element-42": {
      x: 420,
      y: 180,
      updated_by: currentUser.id,
    },
  },
});

// Presence is ephemeral and is never written into custom-object fields.
await subscription.updatePresence({
  cursor: { x: 420, y: 180 },
  selectedElementIds: ["element-42"],
  activity: "active",
});

await subscription.save();
subscription.close();
```

Connection states have these meanings:

- `connecting`: the initial transport and channel join are in progress.
- `live`: the current snapshot is materialized and queued patches are acknowledged.
- `reconnecting`: transport recovery is in progress.
- `offline`: the browser reports that network connectivity is unavailable.
- `unauthorized`: authentication or authorization failed. This state is terminal.
- `closed`: the caller closed the subscription or the object no longer exists.

Each snapshot also preserves the server's `readonly` flag and resolved
`connectionId`. Initial collaborators from the join response are delivered
through `onPresence` before the subscription becomes `live`.

`close()` removes channel listeners, stops reconnect attempts, rejects pending
queued updates, leaves the channel when possible, and closes the socket.

## React effect cleanup

```tsx
useEffect(() => {
  const subscription =
    archAstro.customObjectSubscriptions.subscribe<DiagramFields>({
      objectId: diagramId,
      fieldsSchema: DiagramFields,
      onSnapshot: setDocumentFromSnapshot,
      onUpdate: mergeRemoteUpdate,
      onPresence: upsertCollaborator,
      onPresenceLeave: removeCollaborator,
      onStateChange: setConnectionState,
      onError: setCollaborationError,
    });

  return () => {
    subscription.close();
  };
}, [diagramId]);
```

Create one subscription per mounted document. Always close the old subscription
before subscribing to another object; this prevents duplicate listeners after
navigation or React effect re-runs.

## Retry and convergence rules

Plain nested-map assignments sent through `subscription.update()` are
idempotent. While disconnected, the SDK compacts superseded nested assignments.
After reconnect it:

1. authenticates and joins again;
2. delivers the authoritative current snapshot;
3. replays compacted idempotent assignments;
4. waits for acknowledgements;
5. transitions to `live`.

Do not blindly retry array append/prepend/remove operations, creates without a
stable upsert key, deletes, or another mutation whose first acknowledgement may
have been lost. HTTP reads are safe for the application to retry with bounded
backoff. Do not retry authentication, authorization, or validation errors.

Nested maps are preferable to one shared array for collaborative documents.
Updating `elements_by_id.element-42.x` leaves other elements and other properties
untouched, while replacing an array makes the entire collection one conflict
unit.

Presence remains ephemeral because cursors, selections, idle state, and browser
connection IDs have no durable document meaning. Persisting them would create
stale collaborators and unnecessary custom-object writes.

Snapshot and remote-update handlers must use an internal guard, as shown above,
so applying remote state does not produce a local outgoing mutation. Also compare
canonical values rather than timestamps alone.

If access is revoked, the subscription reports an authentication or
authorization error, transitions to `unauthorized`, stops reconnecting, and
rejects further durable updates. The application should disable editing while
leaving navigation and export of already authorized local data accessible as
appropriate.
