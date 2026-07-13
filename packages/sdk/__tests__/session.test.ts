import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createSessionClient,
  platformSocketUrl,
  type SessionStorage,
  type StoredSession,
} from "../src/session.js";

beforeEach(() => {
  vi.restoreAllMocks();
});

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

describe("platformSocketUrl", () => {
  it("maps http(s) API origin to Phoenix websocket path", () => {
    expect(platformSocketUrl("http://localhost:4005")).toBe(
      "ws://localhost:4005/socket/api/websocket",
    );
    expect(platformSocketUrl("https://platform.archastro.ai/")).toBe(
      "wss://platform.archastro.ai/socket/api/websocket",
    );
    expect(platformSocketUrl("http://127.0.0.1:4005/extra/path")).toBe(
      "ws://127.0.0.1:4005/socket/api/websocket",
    );
  });

  it("rejects invalid base URLs", () => {
    expect(() => platformSocketUrl("")).toThrow(/Invalid API base URL/);
    expect(() => platformSocketUrl("://broken")).toThrow(/Invalid API base URL/);
  });
});

describe("createSessionClient", () => {
  it("restores session from storage and exposes getAccessToken", async () => {
    const storage = memoryStorage({
      accessToken: "at_1",
      refreshToken: "rt_1",
      user: { id: "usr_1", email: "a@b.co" },
    });
    const session = createSessionClient({
      baseUrl: "http://localhost:4005",
      publishableKey: "pk_test",
      storage,
    });
    const restored = await session.restore();
    expect(restored?.accessToken).toBe("at_1");
    expect(session.getSession()?.user?.email).toBe("a@b.co");
  });

  it("establish persists tokens via storage", async () => {
    const storage = memoryStorage();
    const save = vi.spyOn(storage, "save");
    const session = createSessionClient({
      baseUrl: "http://localhost:4005",
      publishableKey: "pk_test",
      storage,
    });
    await session.establish(
      { accessToken: "at_new", refreshToken: "rt_new", tokenExpiry: 3600 },
      { id: "usr_x", email: "x@y.z" },
    );
    expect(save).toHaveBeenCalled();
    expect(session.getSession()?.accessToken).toBe("at_new");
    expect(session.getSession()?.user?.id).toBe("usr_x");
  });

  it("clear wipes storage", async () => {
    const storage = memoryStorage({
      accessToken: "at",
      refreshToken: "rt",
    });
    const session = createSessionClient({
      baseUrl: "http://localhost:4005",
      publishableKey: "pk_test",
      storage,
    });
    await session.restore();
    await session.clear();
    expect(session.getSession()).toBeNull();
    expect(await storage.load()).toBeNull();
  });

  it("restore drops access-only sessions that cannot auto-renew", async () => {
    const storage = memoryStorage({
      accessToken: "at_only",
      // no refreshToken
      user: { id: "usr_1" },
    });
    const session = createSessionClient({
      baseUrl: "http://localhost:4005",
      publishableKey: "pk_test",
      storage,
    });
    const restored = await session.restore();
    expect(restored).toBeNull();
    expect(session.getSession()).toBeNull();
    expect(await storage.load()).toBeNull();
  });

  it("establish requires a refresh token", async () => {
    const session = createSessionClient({
      baseUrl: "http://localhost:4005",
      publishableKey: "pk_test",
      storage: memoryStorage(),
    });
    await expect(
      session.establish({ accessToken: "at_only" }, { id: "usr_x" }),
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
      // First protected call 401, retry 200
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

    const session = createSessionClient({
      baseUrl: "http://localhost:4005",
      publishableKey: "pk_test",
      storage,
    });
    await session.restore();
    const me = await session.client.users.me();
    expect(me).toEqual({ id: "usr_1", email: "a@b.co" });
    expect(session.getSession()?.accessToken).toBe("at_fresh");
    expect(session.getSession()?.refreshToken).toBe("rt_fresh");
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

    const session = createSessionClient({
      baseUrl: "http://localhost:4005",
      publishableKey: "pk_test",
      storage,
    });
    await session.restore();
    const me = await session.client.users.me();
    expect(me).toEqual({ id: "usr_1" });
    // In-memory rotation must succeed even though persist failed.
    expect(session.getSession()?.accessToken).toBe("at_fresh");
    expect(session.getSession()?.refreshToken).toBe("rt_fresh");
  });
});
