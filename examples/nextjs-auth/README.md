# Next.js Auth Example

Authentication for a Next.js app using the ArchAstro SDK with the Backend-for-Frontend (BFF) pattern.

## Architecture

The BFF pattern stores the refresh token in an httpOnly cookie, which:
- Prevents XSS attacks from stealing tokens
- Keeps the refresh token server-side
- Provides automatic cross-tab session sharing

`createSessionManager` and `createAuthActions` from `@archastro/sdk-nextjs/server` handle:
- Cookie read/write via `next/headers`
- Token refresh via server actions
- Session establishment from passwords, magic-link tokens, and federated providers

## Setup

See the parent [`examples/README.md`](../README.md) for repo-wide install + tenant configuration steps. Then from the repo root:

```sh
cp examples/nextjs-auth/.env.example examples/nextjs-auth/.env
# fill in SESSION_SECRET, NEXT_PUBLIC_PUBLISHABLE_KEY, NEXT_PUBLIC_API_BASE_URL
npm run dev:auth
```

## Key files

- `lib/config.ts` — SDK configuration loaded from env
- `lib/auth.ts` — Server actions: login, register, magic-link, federated, refresh, logout
- `app/auth/callback/route.ts` — Magic-link / federated callback handler
- `components/LoginForm.tsx` — Email + password form, plus Google/GitHub buttons
- `components/UserProfile.tsx` — Reads the current user via `useCurrentUser()`

## Usage

### Server components

```tsx
import { getServerClient } from "@/lib/auth";

export default async function Page() {
  const client = await getServerClient();
  if (!client) redirect("/login");

  const user = await client.users.me();
  return <div>Hello {user.name ?? user.email}</div>;
}
```

### Client components

```tsx
"use client";
import { useCurrentUser } from "@archastro/sdk-nextjs/client";

export function Profile() {
  const user = useCurrentUser();
  if (!user) return null;
  return <div>Hello {user.name ?? user.email}</div>;
}
```

### Auth actions

```tsx
"use client";
import { loginWithPassword } from "@/lib/auth";
import { useRefreshSession } from "@archastro/sdk-nextjs/client";
import { useRouter } from "next/navigation";

const router = useRouter();
const refreshSession = useRefreshSession();

const result = await loginWithPassword(email, password);
if (result.success) {
  await refreshSession();
  router.push("/dashboard");
}
```

Magic-link callback (in `app/auth/callback/route.ts`) calls `handleMagicLink(token)` from
`@archastro/sdk-nextjs/server` to exchange a one-time token from a URL into a session.
