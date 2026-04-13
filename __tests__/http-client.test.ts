import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpClient, ApiError } from "../src/runtime/http-client.js";

function mockFetch(responses: Array<{ status: number; body?: unknown }>) {
  let callIndex = 0;
  return vi.fn(async () => {
    const resp = responses[callIndex++] ?? responses[responses.length - 1];
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      json: async () => resp.body ?? {},
      headers: new Headers(),
      body: null,
    } as unknown as Response;
  });
}

describe("HttpClient 401 auto-refresh", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("retries with a new token after 401 when refresh handler succeeds", async () => {
    const fetchMock = mockFetch([
      { status: 401, body: { error: "unauthenticated", message: "expired" } },
      { status: 200, body: { id: "123" } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient({
      baseUrl: "https://api.test",
      accessToken: "expired-token",
      onRefreshToken: async () => "fresh-token",
    });

    const result = await client.request<{ id: string }>("/api/v1/things");

    expect(result).toEqual({ id: "123" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second call should use the new token
    const secondCallHeaders = (fetchMock.mock.calls[1][1] as RequestInit)
      .headers as Record<string, string>;
    expect(secondCallHeaders["Authorization"]).toBe("Bearer fresh-token");
  });

  it("throws 401 when no refresh handler is configured", async () => {
    const fetchMock = mockFetch([
      { status: 401, body: { error: "unauthenticated", message: "expired" } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient({
      baseUrl: "https://api.test",
      accessToken: "expired-token",
    });

    await expect(client.request("/api/v1/things")).rejects.toThrow(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws 401 when refresh handler also fails", async () => {
    const fetchMock = mockFetch([
      { status: 401, body: { error: "unauthenticated", message: "expired" } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient({
      baseUrl: "https://api.test",
      accessToken: "expired-token",
      onRefreshToken: async () => {
        throw new Error("refresh token expired");
      },
    });

    await expect(client.request("/api/v1/things")).rejects.toThrow(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry on non-401 errors", async () => {
    const fetchMock = mockFetch([
      { status: 403, body: { error: "forbidden", message: "no access" } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const refreshHandler = vi.fn(async () => "fresh-token");
    const client = new HttpClient({
      baseUrl: "https://api.test",
      accessToken: "some-token",
      onRefreshToken: refreshHandler,
    });

    await expect(client.request("/api/v1/things")).rejects.toThrow(ApiError);
    expect(refreshHandler).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry auth paths (prevents recursion from refresh client)", async () => {
    const fetchMock = mockFetch([
      { status: 401, body: { error: "unauthenticated", message: "expired" } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const refreshHandler = vi.fn(async () => "fresh-token");
    const client = new HttpClient({
      baseUrl: "https://api.test",
      accessToken: "expired-token",
      onRefreshToken: refreshHandler,
    });

    // Auth paths should never trigger refresh
    await expect(client.request("/api/v1/auth/refresh", { method: "POST" }))
      .rejects.toThrow(ApiError);
    expect(refreshHandler).not.toHaveBeenCalled();
  });

  it("refreshOnly client throws on non-auth paths", async () => {
    const client = new HttpClient({
      baseUrl: "https://api.test",
      refreshOnly: true,
    });

    await expect(client.request("/api/v1/agents"))
      .rejects.toThrow("Refresh-only HTTP client cannot make requests outside");

    // Auth paths should work
    const fetchMock = mockFetch([{ status: 200, body: { token: "t" } }]);
    vi.stubGlobal("fetch", fetchMock);
    const result = await client.request("/api/v1/auth/refresh", { method: "POST" });
    expect(result).toEqual({ token: "t" });
  });

  it("concurrent 401s piggyback on the same refresh", async () => {
    let refreshCallCount = 0;
    let callIndex = 0;
    const fetchMock = vi.fn(async () => {
      callIndex++;
      if (callIndex <= 2) {
        return {
          ok: false, status: 401,
          json: async () => ({ error: "unauthenticated" }),
          headers: new Headers(), body: null,
        } as unknown as Response;
      }
      return {
        ok: true, status: 200,
        json: async () => ({ id: `item-${callIndex}` }),
        headers: new Headers(), body: null,
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient({
      baseUrl: "https://api.test",
      accessToken: "expired-token",
      onRefreshToken: async () => {
        refreshCallCount++;
        return "fresh-token";
      },
    });

    const [a, b] = await Promise.all([
      client.request<{ id: string }>("/api/v1/things"),
      client.request<{ id: string }>("/api/v1/stuff"),
    ]);

    expect(a.id).toBeDefined();
    expect(b.id).toBeDefined();
    expect(refreshCallCount).toBe(1);
    // 2 original (both 401) + 2 retries (both 200)
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("propagates retry error when refresh succeeds but retry fails", async () => {
    const fetchMock = mockFetch([
      { status: 401, body: { error: "unauthenticated", message: "expired" } },
      { status: 403, body: { error: "forbidden", message: "no access" } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient({
      baseUrl: "https://api.test",
      accessToken: "expired-token",
      onRefreshToken: async () => "fresh-token",
    });

    const err = await client.request("/api/v1/things").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clears _refreshPromise after failure so future refreshes work", async () => {
    let callIndex = 0;
    const fetchMock = vi.fn(async () => {
      callIndex++;
      // First request: 401
      if (callIndex === 1) return { ok: false, status: 401, json: async () => ({ error: "unauthenticated" }), headers: new Headers(), body: null } as unknown as Response;
      // Second request (after failed refresh retry): 401 again
      if (callIndex === 2) return { ok: false, status: 401, json: async () => ({ error: "unauthenticated" }), headers: new Headers(), body: null } as unknown as Response;
      // Third request (second refresh attempt succeeds): 200
      return { ok: true, status: 200, json: async () => ({ id: "ok" }), headers: new Headers(), body: null } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    let attempt = 0;
    const client = new HttpClient({
      baseUrl: "https://api.test",
      accessToken: "expired-token",
      onRefreshToken: async () => {
        attempt++;
        if (attempt === 1) throw new Error("refresh failed");
        return "fresh-token";
      },
    });

    // First call: refresh fails → throws 401
    await expect(client.request("/api/v1/things")).rejects.toThrow(ApiError);

    // Second call: refresh succeeds → retries → 200
    const result = await client.request<{ id: string }>("/api/v1/things");
    expect(result).toEqual({ id: "ok" });
    expect(attempt).toBe(2);
  });

  it("updates token via setRefreshHandler", async () => {
    const fetchMock = mockFetch([
      { status: 401, body: { error: "unauthenticated", message: "expired" } },
      { status: 200, body: { ok: true } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient({
      baseUrl: "https://api.test",
      accessToken: "expired-token",
    });

    client.setRefreshHandler(async () => "refreshed-token");

    const result = await client.request<{ ok: boolean }>("/api/v1/things");
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refreshOnly client throws on non-auth requestStream", async () => {
    const client = new HttpClient({
      baseUrl: "https://api.test",
      refreshOnly: true,
    });

    await expect(client.requestStream("/api/v1/agents"))
      .rejects.toThrow("Refresh-only HTTP client cannot make requests outside");
  });

  it("retries requestStream on 401", async () => {
    const stream = new ReadableStream();
    let callIndex = 0;
    const fetchMock = vi.fn(async () => {
      callIndex++;
      if (callIndex === 1) {
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
        json: async () => ({}),
        headers: new Headers(),
        body: stream,
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient({
      baseUrl: "https://api.test",
      accessToken: "expired-token",
      onRefreshToken: async () => "fresh-token",
    });

    const result = await client.requestStream("/api/v1/events");
    expect(result).toBe(stream);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
