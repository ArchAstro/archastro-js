# @archastro/sdk

TypeScript SDK for the ArchAstro Platform API.

## Documentation

API reference documentation is published at
[archastro.github.io/archastro-js](https://archastro.github.io/archastro-js/).

## Install

```sh
npm install @archastro/sdk
```

## Basic Usage

```ts
import { PlatformClient } from "@archastro/sdk";

const client = new PlatformClient({
  defaultHeaders: {
    "x-archastro-api-key": process.env.ARCHASTRO_API_KEY ?? "",
  },
});
```

The generated API surface includes typed REST resources, auth helpers, and
channel clients. The lower-level Phoenix Channel client is documented in
[`src/phx_channel/README.md`](./src/phx_channel/README.md).
