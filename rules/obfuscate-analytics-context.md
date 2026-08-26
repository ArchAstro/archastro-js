---
name: Obfuscate Analytics Context
description: Analytics code must send bounded, allowlisted context instead of raw URLs, tokens, or user-authored content.
date: 2026-08-26
---

# Obfuscate Analytics Context

Analytics helpers and product integrations must treat event properties as a
privacy boundary. Prefer small, classified fields that preserve attribution or
workflow meaning without copying sensitive browser state, credentials, form
values, or user-authored content into analytics.

Browser context should be reduced before it is sent: route templates or static
paths instead of raw browser pathnames, token-like path segments redacted,
referrer hostnames instead of full referrer URLs, allowlisted campaign
parameters, and bounded string lengths. Product-specific properties are allowed
when the owning product has classified the field as safe for analytics. The
narrow exception is an explicit debugging or compliance event whose contract
names the sensitive field and routes it to an appropriate non-analytics store.

## Positive example

```ts
await client.analytics.track("page_view", {
  ...safeBrowserAnalyticsProperties(),
  surface: "dashboard",
});
```

This records the route and attribution shape needed for analytics without
persisting query tokens, hashes, complete referrer paths, or unbounded values.

## Counterexample

```ts
await client.analytics.track("page_view", {
  href: window.location.href,
  referrer: document.referrer,
  search: window.location.search,
  email: form.email.value,
});
```

Full URLs and raw query strings routinely contain invitation codes, OAuth
state, access tokens, and customer-entered values. Sending them as event
properties makes every downstream analytics sink inherit that exposure.
