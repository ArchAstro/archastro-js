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
Generated TypeScript clients expose the generic `PlatformClient.extend` class
mixin seam; they must not know an extension's methods or lifecycle policy.
SDK-specific generator configuration may list hand-written modules for the
generated package barrel. After regeneration, run the strict consumer type
fixture plus the hand-written behavior tests so lost exports, factory subtype
regressions, and broken extension chaining fail before release.

The narrow exception is behavior that is mechanically derivable from the API
contract. Add that behavior to the generator input or generator itself instead
of maintaining parallel hand-written copies.

## Positive example

```ts
// Generated code owns only the generic class-expression mixin seam.
const RealtimePlatformClient = PlatformClient.extend(
  withCustomObjectSubscriptions,
);

// Application code uses the hand-written lifecycle manager.
const client = new RealtimePlatformClient(config);
const subscription = client.customObjectSubscriptions.subscribe({
  objectId,
  onSnapshot,
  onUpdate,
  onStateChange,
  onError,
});

const tokenClient = RealtimePlatformClient.withToken(apiKey, accessToken);
expect(tokenClient.customObjectSubscriptions).toBeDefined();
```

The generated channel supplies join, push, and event methods. The hand-written
mixin owns socket authentication and routing; the manager owns reconnect,
convergence, presence refresh, and cleanup. The generated static factories use
polymorphic `this`, so they construct the extended class rather than silently
returning a base client.

## Counterexample

```ts
// Do not teach the generator one extension's imports, config, or methods.
if (spec.channels.some((channel) => channel.className === "ApiObjectChannel")) {
  imports.add("./custom-object-subscriptions.js", "CustomObjectSubscriptions");
  cb.line("readonly customObjectSubscriptions: CustomObjectSubscriptions;");
}
```

This couples codegen to one capability that is not mechanically derived from
the API contract. It also forces every future hand-written capability to add
another generator special case. Keep those decisions in a mixin module and
export that module through generic generator configuration.
