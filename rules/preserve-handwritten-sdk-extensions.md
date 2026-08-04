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
hand-written extension, preserve that integration and keep a test that fails
when regeneration drops it.

The narrow exception is behavior that is mechanically derivable from the API
contract. Add that behavior to the generator input or generator itself instead
of maintaining parallel hand-written copies.

## Positive example

```ts
// Hand-written lifecycle manager built on the generated channel binding.
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
manager owns reconnect, convergence, presence refresh, and cleanup, while the
public-surface assertion catches accidental removal during regeneration.

## Counterexample

```ts
// Do not replace a hand-written manager with a generated channel primitive.
const channel = await ApiObjectChannel.joinById(socket, objectId);
```

The channel can move frames, but it does not preserve queued edits, recover an
authoritative snapshot, refresh presence, classify terminal access failures, or
clean up a mounted application's subscription lifecycle.
