---
name: Preserve Hand-Written SDK Extensions
description: OpenAPI regeneration must preserve and verify hand-written SDK behavior layered over generated transport primitives.
date: 2026-08-04
---

# Preserve Hand-Written SDK Extensions

The OpenAPI generator owns schema-derived types, REST resources, and thin
channel bindings. Lifecycle behavior such as reconnect recovery, offline
mutation queues, presence heartbeats, session storage, and framework adapters
belongs in hand-written SDK modules.

Regeneration is not permission to remove those modules or their public wiring.
After regeneration, run the hand-written public-surface and behavior tests. If
a generated entry point such as `PlatformClient` or `index.ts` exposes a
hand-written extension, the generator may emit a small delegation call and
barrel export. Keep transport, authentication, retry, and lifecycle policy
behind that hand-written entrypoint, and keep a test that fails when
regeneration drops the delegation.

The narrow exception is behavior that is mechanically derivable from the API
contract. Add that behavior to the generator input or generator itself instead
of maintaining parallel hand-written copies.

## Positive example

```ts
// Generated client glue delegates without owning extension policy.
this.customObjectSubscriptions = customObjectSubscriptionsForClient(
  config,
  this.http,
);

// Application code uses the hand-written lifecycle manager.
const subscription = client.customObjectSubscriptions.subscribe({
  objectId,
  onSnapshot,
  onUpdate,
  onStateChange,
  onError,
});

expect(client.customObjectSubscriptions).toBeInstanceOf(
  CustomObjectSubscriptions,
);
```

The generated channel supplies join, push, and event methods. The hand-written
factory owns socket authentication and routing; the manager owns reconnect,
convergence, presence refresh, and cleanup. The public-surface assertion catches
accidental removal during regeneration.

## Counterexample

```ts
// Do not embed extension policy in the generator.
this.customObjectSubscriptions = new CustomObjectSubscriptions(() =>
  createPlatformSocket({
    accessToken: this.http.getAccessToken(),
    socketPath: `${config.pathPrefix}/socket`,
  }),
);
```

This couples codegen to one runtime's authentication, routing, and reconnect
policy. Those decisions drift independently of the API contract and belong in
the hand-written extension entrypoint.
