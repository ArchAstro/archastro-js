import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlatformClient } from "../src/platform-client.js";
import type { SessionStorage, StoredSession } from "../src/user-session.js";
import { platformSocketUrl } from "../src/runtime/url.js";

function memoryStorage(seed?: StoredSession | null): SessionStorage {
  let value: StoredSession | null = seed ?? null;
  return {
    load: async () => value,
    save: async (s) => {
      value = s;
    },
    clear: async () => {
      value = null;
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("platformSocketUrl", () => {
  it("maps http(s) API origin to Phoenix websocket path", () => {
    expect(platformSocketUrl("http://localhost:4005")).toBe(
      "ws://localhost:4005/socket/api/websocket",
    );
    expect(platformSocketUrl("https://platform.archastro.ai/")).toBe(
      "wss://platform.archastro.ai/socket/api/websocket",
    );
  });
});

describe("PlatformClient.forApp", () => {
  it("restores session from storage", async () => {
    const storage = memoryStorage({
      accessToken: "at_1",
      refreshToken: "rt_1",
      user: { id: "usr_1", email: "a@b.co" },
    });
    const client = PlatformClient.forApp({
      baseUrl: "http://localhost:4005",
      publishableKey: "pk_test",
      storage,
    });
    const restored = await client.restore();
    expect(restored?.accessToken).toBe("at_1");
    expect(client.getSession()?.user?.email).toBe("a@b.co");
    // still a PlatformClient — resources exist
    expect(client.agents).toBeDefined();
    expect(client.passwordless).toBeDefined();
  });

  it("signIn persists tokens via storage", async () => {
    const storage = memoryStorage();
    const save = vi.spyOn(storage, "save");
    const client = PlatformClient.forApp({
      baseUrl: "http://localhost:4005",
      publishableKey: "pk_test",
      storage,
    });
    await client.signIn(
      { accessToken: "at_new", refreshToken: "rt_new", tokenExpiry: 3600 },
      { id: "usr_x", email: "x@y.z" },
    );
    expect(save).toHaveBeenCalled();
    expect(client.getSession()?.accessToken).toBe("at_new");
    expect(client.getSession()?.user?.id).toBe("usr_x");
  });

  it("signOut wipes storage and session", async () => {
    const storage = memoryStorage({
      accessToken: "at",
      refreshToken: "rt",
    });
    const client = PlatformClient.forApp({
      baseUrl: "http://localhost:4005",
      publishableKey: "pk_test",
      storage,
    });
    await client.restore();
    await client.signOut();
    expect(client.getSession()).toBeNull();
    expect(await storage.load()).toBeNull();
  });

  it("restore drops access-only sessions that cannot auto-renew", async () => {
    const storage = memoryStorage({
      accessToken: "at_only",
      user: { id: "usr_1" },
    });
    const client = PlatformClient.forApp({
      baseUrl: "http://localhost:4005",
      publishableKey: "pk_test",
      storage,
    });
    const restored = await client.restore();
    expect(restored).toBeNull();
    expect(client.getSession()).toBeNull();
    expect(await storage.load()).toBeNull();
  });

  it("signIn requires a refresh token", async () => {
    const client = PlatformClient.forApp({
      baseUrl: "http://localhost:4005",
      publishableKey: "pk_test",
      storage: memoryStorage(),
    });
    await expect(
      client.signIn({ accessToken: "at_only" }, { id: "usr_x" }),
    ).rejects.toThrow(/refresh token/i);
  });

  it("auto-refreshes on 401 and persists rotated tokens", async () => {
    const storage = memoryStorage({
      accessToken: "at_expired",
      refreshToken: "rt_old",
      user: { id: "usr_1", email: "a@b.co" },
    });
    let call = 0;
    const fetchMock = vi.fn(async (url: string) => {
      call += 1;
      if (String(url).includes("/auth/refresh")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            token: "at_fresh",
            refresh_token: "rt_fresh",
            expires_in: 3600,
          }),
          headers: new Headers(),
          body: null,
        } as unknown as Response;
      }
      if (call === 1) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: "unauthenticated" }),
          headers: new Headers(),
          body: null,
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "usr_1", email: "a@b.co" }),
        headers: new Headers(),
        body: null,
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = PlatformClient.forApp({
      baseUrl: "http://localhost:4005",
      publishableKey: "pk_test",
      storage,
    });
    await client.restore();
    const me = await client.users.me();
    expect(me).toEqual({ id: "usr_1", email: "a@b.co" });
    expect(client.getSession()?.accessToken).toBe("at_fresh");
    expect(client.getSession()?.refreshToken).toBe("rt_fresh");
    expect(await storage.load()).toMatchObject({
      accessToken: "at_fresh",
      refreshToken: "rt_fresh",
    });
  });

  it("rotation still succeeds when storage.save throws", async () => {
    let value: StoredSession | null = {
      accessToken: "at_expired",
      refreshToken: "rt_old",
      user: { id: "usr_1" },
    };
    const storage: SessionStorage = {
      load: async () => value,
      save: async () => {
        throw new Error("SecureStore value too large");
      },
      clear: async () => {
        value = null;
      },
    };
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        n += 1;
        if (String(url).includes("/auth/refresh")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              token: "at_fresh",
              refresh_token: "rt_fresh",
              expires_in: 3600,
            }),
            headers: new Headers(),
            body: null,
          } as unknown as Response;
        }
        if (n === 1) {
          return {
            ok: false,
            status: 401,
            json: async () => ({ error: "unauthenticated" }),
            headers: new Headers(),
            body: null,
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "usr_1" }),
          headers: new Headers(),
          body: null,
        } as unknown as Response;
      }),
    );

    const client = PlatformClient.forApp({
      baseUrl: "http://localhost:4005",
      publishableKey: "pk_test",
      storage,
    });
    await client.restore();
    const me = await client.users.me();
    expect(me).toEqual({ id: "usr_1" });
    expect(client.getSession()?.accessToken).toBe("at_fresh");
    expect(client.getSession()?.refreshToken).toBe("rt_fresh");
  });

  it("createSocket requires a signed-in session", async () => {
    const client = PlatformClient.forApp({
      baseUrl: "http://localhost:4005",
      publishableKey: "pk_test",
      storage: memoryStorage(),
    });
    expect(() => client.createSocket()).toThrow(/not signed in/i);

    await client.signIn(
      { accessToken: "at", refreshToken: "rt" },
      { id: "usr_1" },
    );
    const socket = client.createSocket();
    expect(socket).toBeDefined();
  });

  it("preserves other PlatformClient factories", () => {
    const secret = PlatformClient.withSecretKey("sk_test", "http://localhost:4005");
    expect(secret.agents).toBeDefined();
    const token = PlatformClient.withToken(
      "pk_test",
      "at",
      "http://localhost:4005",
    );
    expect(token.agents).toBeDefined();
  });
});
