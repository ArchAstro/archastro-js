// Drives the package entry point (`@archastro/sdk` -> dist/index.js, the files
// npm publishes) over real loopback HTTP. Run `npm run build` first; CI builds
// before `npm test`. The canned server records the wire contract only; it does
// not model platform authorization or provisioning.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { PlatformClient } from "@archastro/sdk";

interface RecordedRequest {
  method: string | undefined;
  url: string | undefined;
  apiKey: string | undefined;
  authorization: string | undefined;
  contentType: string | undefined;
  body: unknown;
}

interface CannedResponse {
  status: number;
  body?: unknown;
}

const computer = {
  id: "cmp_thread_1",
  name: "Build box",
  thread_id: "thr_1",
  status: "provisioning",
  provider: "test",
  region: "local",
  config: {},
  metadata: { purpose: "e2e" },
  created_at: "2026-10-21T00:00:00Z",
  updated_at: "2026-10-21T00:00:00Z",
};

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw === "" ? undefined : JSON.parse(raw);
}

async function startPlatform(responses: Record<string, CannedResponse>) {
  const requests: RecordedRequest[] = [];
  const server = createServer(async (req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      apiKey: req.headers["x-archastro-api-key"] as string | undefined,
      authorization: req.headers.authorization,
      contentType: req.headers["content-type"],
      body: await readBody(req),
    });
    const canned = responses[`${req.method} ${req.url}`] ?? { status: 404, body: { error: "not_found" } };
    if (canned.body === undefined) {
      res.writeHead(canned.status).end();
    } else {
      res.writeHead(canned.status, { "Content-Type": "application/json" }).end(JSON.stringify(canned.body));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, requests, baseUrl: `http://127.0.0.1:${port}` };
}

describe("thread computers e2e", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  it("published SDK creates and lists thread computers and updates computer shares", async () => {
    // Setup: a loopback platform that answers the three thread-computer routes.
    const platform = await startPlatform({
      "POST /api/v1/threads/thr_1/computers": { status: 201, body: computer },
      "GET /api/v1/threads/thr_1/computers": { status: 200, body: { data: [computer] } },
      "PATCH /api/v1/agent_computers/cmp_thread_1": { status: 204 },
    });
    server = platform.server;
    const client = PlatformClient.withToken("pk_test_key", "user_access_token", platform.baseUrl);

    // Action: provision, list, then revoke every direct share with empty grants.
    const created = await client.threads.computers.create("thr_1", {
      name: "Build box",
      metadata: { purpose: "e2e" },
    });
    const listed = await client.threads.computers.list("thr_1");
    const updated = await client.agent_computers.update("cmp_thread_1", { acl: { grants: [] } });

    // Outcome: the SDK returned each body (void on 204) and sent the documented wire contract.
    expect(created).toEqual(computer);
    expect(listed).toEqual({ data: [computer] });
    expect(updated).toBeUndefined();

    expect(platform.requests.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
      {
        method: "POST",
        url: "/api/v1/threads/thr_1/computers",
        body: { name: "Build box", metadata: { purpose: "e2e" } },
      },
      { method: "GET", url: "/api/v1/threads/thr_1/computers", body: undefined },
      {
        method: "PATCH",
        url: "/api/v1/agent_computers/cmp_thread_1",
        body: { acl: { grants: [] } },
      },
    ]);
    for (const request of platform.requests) {
      expect(request.apiKey).toBe("pk_test_key");
      expect(request.authorization).toBe("Bearer user_access_token");
      expect(request.contentType).toBe("application/json");
    }
  });
});
