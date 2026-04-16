# Examples

Self-contained sample apps that consume the SDK packages from this monorepo via npm workspaces. Each example is a private workspace package; its `@archastro/sdk` and `@archastro/sdk-nextjs` deps are symlinked to `packages/*` so changes there are picked up after a rebuild.

## Available examples

| Path | What it shows |
|------|---------------|
| [`nextjs-auth`](./nextjs-auth) | Next.js + BFF auth (password + magic link + OAuth) using `@archastro/sdk-nextjs/server` and `/client` |
| [`nextjs-agent-threads`](./nextjs-agent-threads) | Next.js chat UI built on `@archastro/sdk-nextjs/chat` for the signed-in user's threads |

## Quick start

From the repo root:

```sh
npm install                      # one-time, installs the whole workspace
npm run build                    # build the SDKs the examples link to
cp examples/nextjs-auth/.env.example examples/nextjs-auth/.env
# fill in .env (see "Hooking up your tenant" below)
npm run dev:auth                 # or: npm run dev -w examples/nextjs-auth
```

Other shortcut: `npm run dev:threads` for `nextjs-agent-threads`.

## Hooking up your tenant

The defaults in `.env.example` (`pk_dummy`) and `archastro.json` (the demo `dap_…`/`dsb_…`) point at the original demo tenant and won't authenticate against your own deployment. The fastest way to get your own values is `archastro init`.

### Install the CLI

```sh
brew install ArchAstro/tools/archastro     # or follow the platform's install docs
archastro auth login                       # browser flow
archastro auth status
```

### Option A — `archastro init` (recommended)

Run from the example's directory. It opens the developer portal in your browser, lets you pick (or create) an app, then writes `archastro.json` for you and prints a fresh publishable key:

```sh
cd examples/nextjs-auth
archastro init
# → Browser: pick or create an app
# → Writes archastro.json with { "app": "dap_…", "sandbox": "dsb_…" (if returned) }
# → Prints:  Publishable key  pk_…
#            ⚠ Save this key now — it will not be shown again.
```

What `init` does for you:
- Writes `archastro.json` linking this directory to your app (and the sandbox the portal returned, if any).
- Auto-creates a publishable key on the server and prints it to stdout **once** — copy it into `.env` immediately.
- Optionally sets up a local `configs/` directory if you answer "y" to the prompt.

What it doesn't do:
- It doesn't write `.env`. Copy the printed `pk_…` into `NEXT_PUBLIC_PUBLISHABLE_KEY` yourself.
- It doesn't create a sandbox. If `init` didn't write a `sandbox` field (or you want a separate one for local dev), see Option B step 2.

Repeat for the other example:
```sh
cd examples/nextjs-agent-threads
archastro init
```

### Option B — manual (existing app, sandbox-scoped key, or scripting)

Use this if you already have an app, want a sandbox-scoped key (smaller blast radius), or are setting up CI.

**1. Find your app id** (`dap_…`):
```sh
archastro list apps --json
```
There's no `archastro create app` subcommand — new apps are created through the developer portal browser flow (`archastro init` triggers it for you).

**2. Create or find a sandbox** (`dsb_…`):
```sh
archastro create sandbox -n "Local dev" -s "local-dev" --json
archastro list sandboxes --json
```

**3. Mint a publishable key** (`pk_…`):

App-scoped (works against any sandbox):
```sh
archastro create appkey -t publishable --json
# →  {"full_key": "pk_…", …}
```

Sandbox-scoped (recommended for local dev):
```sh
archastro create sandboxkey --sandbox dsb_… -t publishable --json
```

Publishable keys are safe to ship in client code — they identify the app to the platform but can't perform privileged actions.

**4. Wire it up** by editing two files per example:

- `examples/<name>/archastro.json` — `{ "app": "dap_…", "sandbox": "dsb_…" }`
- `examples/<name>/.env` — set `NEXT_PUBLIC_PUBLISHABLE_KEY=pk_…` and `SESSION_SECRET=` (generate with `openssl rand -base64 32`)

### Pointing at a non-default platform

If you're running the platform locally or against staging, also set `NEXT_PUBLIC_API_BASE_URL` in `.env` (default `http://localhost:4000`).

## Development loop

The examples import from each SDK's `dist/` (per `package.json` `exports`), so rebuild after editing the SDK:

```sh
npm run build -w packages/sdk-nextjs   # or: -w packages/sdk
```

For tighter iteration, run `tsc --watch` in the SDK package and `next dev` in the example side-by-side.
