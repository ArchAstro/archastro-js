// Copyright (c) 2026 ArchAstro Inc. All Rights Reserved.
/**
 * Synthetic integration tests for the generated TypeScript Platform SDK.
 *
 * Tests use the GENERATED PlatformClient with factory constructors and
 * auth flows to verify end-to-end behavior against a live platform.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { PlatformClient } from "../src/client.js";

const PLATFORM_PORT = process.env.PLATFORM_PORT ?? "4005";
const PLATFORM_URL = `http://localhost:${PLATFORM_PORT}`;

let secretKey: string;
let publishableKey: string;
let userEmail: string;
const userPassword = "Password1234";

beforeAll(async () => {
  // Bootstrap via dev harness
  const devRes = await fetch(`${PLATFORM_URL}/dev/setup/developer_account`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "sdk-auth-ts@dev.archastro.local" }),
  });
  const devData = (await devRes.json()) as { access_token: string; app_id: string };

  const skRes = await fetch(
    `${PLATFORM_URL}/protected/api/v1/developer/apps/${devData.app_id}/keys`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${devData.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "secret" }),
    }
  );
  secretKey = ((await skRes.json()) as { full_key: string }).full_key;

  const pkRes = await fetch(
    `${PLATFORM_URL}/protected/api/v1/developer/apps/${devData.app_id}/keys`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${devData.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "publishable" }),
    }
  );
  publishableKey = ((await pkRes.json()) as { full_key: string }).full_key;

  // Create a user for login tests
  userEmail = "sdk-auth-user-ts@dev.archastro.local";
  let userRes = await fetch(`${PLATFORM_URL}/dev/setup/user_account`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: userEmail, password: userPassword }),
  });
  if (!userRes.ok) {
    await fetch(`${PLATFORM_URL}/dev/setup/org_user_account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: userEmail, password: userPassword }),
    });
  }
});

// ─── Factory constructors ───────────────────────────────────────

describe("PlatformClient.withSecretKey", () => {
  it("lists and CRUDs agents", async () => {
    const client = PlatformClient.withSecretKey(secretKey, PLATFORM_URL);

    const result = await client.agents.list();
    expect(result).toHaveProperty("data");

    const created = await client.agents.create({ name: "SK Factory Agent" });
    expect(created.name).toBe("SK Factory Agent");

    const fetched = await client.agents.get(created.id);
    expect(fetched.id).toBe(created.id);

    await client.agents.delete(created.id);
  });
});

// ─── Auth flow: SDK login ───────────────────────────────────────

describe("PlatformClient.withCredentials (SDK login)", () => {
  it("logs in with email/password and makes authenticated requests", async () => {
    const client = await PlatformClient.withCredentials(
      publishableKey,
      userEmail,
      userPassword,
      PLATFORM_URL
    );

    const created = await client.agents.create({ name: "Login Flow Agent" });
    expect(created.id).toBeDefined();

    const fetched = await client.agents.get(created.id);
    expect(fetched.id).toBe(created.id);

    await client.agents.delete(created.id);
  });
});

// ─── Auth client directly ───────────────────────────────────────

describe("client.auth", () => {
  it("login returns tokens", async () => {
    const client = new PlatformClient({
      baseUrl: PLATFORM_URL,
      defaultHeaders: { "x-archastro-api-key": publishableKey },
    });

    const tokens = await client.auth.login(userEmail, userPassword);
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
  });

  it("refresh returns working tokens", async () => {
    const client = new PlatformClient({
      baseUrl: PLATFORM_URL,
      defaultHeaders: { "x-archastro-api-key": publishableKey },
    });

    const tokens = await client.auth.login(userEmail, userPassword);
    const refreshed = await client.auth.refresh(tokens.refreshToken);
    expect(refreshed.accessToken).toBeTruthy();
    expect(refreshed.accessToken).not.toBe(tokens.accessToken);

    // Prove the refreshed token actually works
    client.setAccessToken(refreshed.accessToken);
    const created = await client.agents.create({ name: "Refresh Test Agent" });
    expect(created.id).toBeDefined();
    await client.agents.delete(created.id);
  });

  it("token login exchanges a one-time token for session tokens", async () => {
    // Get a one-time login token from the dev harness
    const tokenRes = await fetch(`${PLATFORM_URL}/dev/setup/login_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: userEmail }),
    });
    expect(tokenRes.ok).toBe(true);
    const { login_token } = (await tokenRes.json()) as { login_token: string };
    expect(login_token).toBeTruthy();

    // Exchange it via the generated SDK auth method
    const client = new PlatformClient({
      baseUrl: PLATFORM_URL,
      defaultHeaders: { "x-archastro-api-key": publishableKey },
    });

    const tokens = await client.auth.exchangeLoginToken(login_token);
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();

    // Use the token to make an authenticated request
    client.setAccessToken(tokens.accessToken);
    const created = await client.agents.create({ name: "Token Login Agent" });
    expect(created.id).toBeDefined();
    await client.agents.delete(created.id);
  });
});

// ─── Error handling ─────────────────────────────────────────────

describe("Error handling", () => {
  it("returns 404 for nonexistent agent", async () => {
    const client = PlatformClient.withSecretKey(secretKey, PLATFORM_URL);
    try {
      await client.agents.get("nonexistent-id-12345");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      expect((err as { status: number }).status).toBe(404);
    }
  });
});
