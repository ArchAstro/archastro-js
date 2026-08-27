---
name: Keep Analytics Helpers First Party
description: SDK analytics helpers are shared ArchAstro app plumbing, not a general public analytics product surface.
date: 2026-08-26
---

# Keep Analytics Helpers First Party

The public SDK may contain analytics helpers because first-party ArchAstro apps
such as Intern and Agent Network run in public browser and package contexts.
Treat those helpers as shared ArchAstro app plumbing, not as a general external
analytics product surface.

Do not promote `client.analytics` in public quickstarts, examples, guides, or
marketing copy unless the platform has a supported customer-facing analytics
contract. If a non-ArchAstro SDK user discovers the methods, they still need a
valid ArchAstro app publishable key and configured platform base URL; successful
events are written to ArchAstro's analytics backend for that app, but there may
be no supported public UI or API for inspecting them.

Product-specific event payloads remain owned by the product sending the event.
Browser context helpers can reduce unsafe browser state, but this rule is about
surface ownership and documentation, not a blanket ban on controlled backend
events whose downstream data contract intentionally includes fields such as an
email address.

## Positive example

```ts
// Intern app code, not SDK quickstart documentation.
await internAnalytics.analytics.track("page_view", properties);
```

The product owns the event contract and uses the SDK helper only to avoid
duplicating ArchAstro's anonymous-id, tracking, and identity-link request
plumbing.

## Counterexample

```md
## Analytics

Use `client.analytics` to add analytics to your app...
```

This presents an internal ArchAstro telemetry endpoint as a public product
feature before the platform has an external analytics contract.
