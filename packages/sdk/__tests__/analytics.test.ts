import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnalyticsClient,
  DEFAULT_ANONYMOUS_ID_COOKIE,
  PlatformClient,
  safeBrowserAnalyticsProperties,
  withAnalytics,
} from "../src/index.js";
import { HttpClient } from "../src/runtime/http-client.js";

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

function installDocumentCookie(seed = "", referrer = "") {
  let cookie = seed;
  let lastWrite = seed;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      referrer,
      get cookie() {
        return cookie;
      },
      set cookie(value: string) {
        lastWrite = value;
        cookie = value
          .split(";")
          .map((part) => part.trim())
          .filter(
            (part) =>
              !part.includes("=") ||
              part.startsWith(`${DEFAULT_ANONYMOUS_ID_COOKIE}=`),
          )
          .join("; ");
      },
    },
  });
  return () => lastWrite;
}

function installLocation(
  protocol: string,
  hostname: string,
  pathname = "/",
  search = "",
) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { protocol, hostname, pathname, search },
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, "document");
  Reflect.deleteProperty(globalThis, "window");
});

describe("AnalyticsClient", () => {
  it("reuses the existing aa_anon_id cookie", () => {
    installDocumentCookie(`${DEFAULT_ANONYMOUS_ID_COOKIE}=anon_existing`);
    const analytics = new AnalyticsClient(
      new HttpClient({ baseUrl: "https://api.test" }),
    );

    expect(analytics.getAnonymousId()).toBe("anon_existing");
  });

  it("reads aa_anon_id from cookie strings without spaces", () => {
    installDocumentCookie(
      `other=value;${DEFAULT_ANONYMOUS_ID_COOKIE}=anon_existing`,
    );
    const analytics = new AnalyticsClient(
      new HttpClient({ baseUrl: "https://api.test" }),
    );

    expect(analytics.getAnonymousId()).toBe("anon_existing");
  });

  it("creates and persists aa_anon_id when no cookie exists", () => {
    const lastCookieWrite = installDocumentCookie();
    installLocation("https:", "tryintern.dev");
    vi.stubGlobal("crypto", { randomUUID: () => "anon_generated" });
    const onGenerated = vi.fn();
    const analytics = new AnalyticsClient(
      new HttpClient({ baseUrl: "https://api.test" }),
      { onAnonymousIdGenerated: onGenerated },
    );

    expect(analytics.getAnonymousId()).toBe("anon_generated");
    expect(lastCookieWrite()).toContain(
      `${DEFAULT_ANONYMOUS_ID_COOKIE}=anon_generated`,
    );
    expect(lastCookieWrite()).toContain("domain=.tryintern.dev");
    expect(lastCookieWrite()).toContain("secure");
    expect(onGenerated).toHaveBeenCalledWith("anon_generated");
  });

  it("falls back to a generated anonymous id without crypto.randomUUID", () => {
    const lastCookieWrite = installDocumentCookie();
    vi.stubGlobal("crypto", {});
    vi.spyOn(Date, "now").mockReturnValue(123456);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const analytics = new AnalyticsClient(
      new HttpClient({ baseUrl: "https://api.test" }),
    );

    expect(analytics.getAnonymousId()).toBe("anon_123456_i");
    expect(lastCookieWrite()).toContain(
      `${DEFAULT_ANONYMOUS_ID_COOKIE}=anon_123456_i`,
    );
  });

  it("replaces malformed anonymous id cookies", () => {
    const lastCookieWrite = installDocumentCookie(
      `${DEFAULT_ANONYMOUS_ID_COOKIE}=%E0%A4%A`,
    );
    vi.stubGlobal("crypto", { randomUUID: () => "anon_recovered" });
    const analytics = new AnalyticsClient(
      new HttpClient({ baseUrl: "https://api.test" }),
    );

    expect(analytics.getAnonymousId()).toBe("anon_recovered");
    expect(lastCookieWrite()).toContain(
      `${DEFAULT_ANONYMOUS_ID_COOKIE}=anon_recovered`,
    );
  });

  it("does not set secure or domain attributes for local HTTP cookies", () => {
    const lastCookieWrite = installDocumentCookie();
    installLocation("http:", "127.0.0.1");
    vi.stubGlobal("crypto", { randomUUID: () => "anon_local" });
    const analytics = new AnalyticsClient(
      new HttpClient({ baseUrl: "http://127.0.0.1:4005" }),
    );

    expect(analytics.getAnonymousId()).toBe("anon_local");
    expect(lastCookieWrite()).not.toContain("domain=");
    expect(lastCookieWrite()).not.toContain("secure");
  });

  it("tracks events through the platform analytics endpoint", async () => {
    installDocumentCookie(`${DEFAULT_ANONYMOUS_ID_COOKIE}=anon_abc`);
    vi.stubGlobal("crypto", { randomUUID: () => "evt_123" });
    const fetchMock = mockFetch([{ status: 202, body: { ok: true } }]);
    vi.stubGlobal("fetch", fetchMock);
    const analytics = new AnalyticsClient(
      new HttpClient({
        baseUrl: "https://api.test",
        defaultHeaders: { "x-archastro-api-key": "pk_test" },
      }),
    );

    await analytics.track(
      "page_view",
      { source: "intern-landing" },
      { properties: { first_landing_page: "/" }, keepalive: true },
    );

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/api/v1/t");
    expect((request as RequestInit).method).toBe("POST");
    expect((request as RequestInit).keepalive).toBe(true);
    expect(JSON.parse((request as RequestInit).body as string)).toEqual({
      events: [
        {
          event_id: "evt_123",
          event_name: "page_view",
          timestamp: expect.any(String),
          event_properties: { source: "intern-landing" },
        },
      ],
      properties: { first_landing_page: "/" },
      anonymous: "anon_abc",
    });
  });

  it("tracks event batches with the SDK-owned anonymous id by default", async () => {
    installDocumentCookie(`${DEFAULT_ANONYMOUS_ID_COOKIE}=anon_batch`);
    const fetchMock = mockFetch([{ status: 202, body: { ok: true } }]);
    vi.stubGlobal("fetch", fetchMock);
    const analytics = new AnalyticsClient(
      new HttpClient({
        baseUrl: "https://api.test",
        defaultHeaders: { "x-archastro-api-key": "pk_test" },
      }),
    );

    await analytics.trackEvents([
      {
        event_id: "evt_123",
        event_name: "page_view",
        timestamp: "2026-08-26T20:00:00.000Z",
      },
    ]);

    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse((request as RequestInit).body as string)).toMatchObject({
      anonymous: "anon_batch",
    });
  });

  it("allows callers to explicitly omit anonymous attribution", async () => {
    installDocumentCookie(`${DEFAULT_ANONYMOUS_ID_COOKIE}=anon_batch`);
    const fetchMock = mockFetch([{ status: 202, body: { ok: true } }]);
    vi.stubGlobal("fetch", fetchMock);
    const analytics = new AnalyticsClient(
      new HttpClient({
        baseUrl: "https://api.test",
        defaultHeaders: { "x-archastro-api-key": "pk_test" },
      }),
    );

    await analytics.trackEvents(
      [
        {
          event_id: "evt_123",
          event_name: "page_view",
          timestamp: "2026-08-26T20:00:00.000Z",
        },
      ],
      { anonymousId: null },
    );

    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse((request as RequestInit).body as string)).not.toHaveProperty(
      "anonymous",
    );
  });

  it("links an anonymous id to an authenticated user", async () => {
    const fetchMock = mockFetch([{ status: 200, body: { linked: true } }]);
    vi.stubGlobal("fetch", fetchMock);
    const analytics = new AnalyticsClient(
      new HttpClient({
        baseUrl: "https://api.test",
        accessToken: "user-token",
        defaultHeaders: { "x-archastro-api-key": "pk_test" },
      }),
    );

    await expect(
      analytics.linkIdentity("anon_abc", "usr_123"),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/api/v1/i",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          anonymous: "anon_abc",
          user: "usr_123",
        }),
      }),
    );
  });
});

describe("withAnalytics", () => {
  it("adds SDK-owned analytics primitives to PlatformClient", async () => {
    const AnalyticsPlatformClient = PlatformClient.extend(withAnalytics());
    const client = AnalyticsPlatformClient.withToken(
      "pk_test",
      "user-token",
      "https://api.test",
    );

    expect(client.analytics).toBeInstanceOf(AnalyticsClient);
  });

  it("configures analytics options through the extension", () => {
    const lastCookieWrite = installDocumentCookie();
    installLocation("https:", "tryintern.dev");
    vi.stubGlobal("crypto", { randomUUID: () => "anon_custom" });
    const AnalyticsPlatformClient = PlatformClient.extend(
      withAnalytics({ cookieDomain: ".example.com", secureCookie: false }),
    );
    const client = new AnalyticsPlatformClient({ baseUrl: "https://api.test" });

    expect(client.analytics.getAnonymousId()).toBe("anon_custom");
    expect(lastCookieWrite()).toContain("domain=.example.com");
    expect(lastCookieWrite()).not.toContain("secure");
  });
});

describe("safeBrowserAnalyticsProperties", () => {
  it("keeps only bounded, non-sensitive browser context", () => {
    installDocumentCookie(
      "",
      "https://search.example/results?q=secret&token=leak",
    );
    installLocation(
      "https:",
      "tryintern.dev",
      "/signup/oauth/callback",
      "?utm_source=newsletter&utm_medium=email&utm_campaign=spring&token=leak",
    );

    expect(safeBrowserAnalyticsProperties()).toEqual({
      referrer: "search.example",
      utm_source: "newsletter",
      utm_medium: "email",
      utm_campaign: "spring",
    });
  });

  it("strips accidental query strings and hashes from explicit paths", () => {
    expect(
      safeBrowserAnalyticsProperties({
        path: "/pricing?token=secret#continue",
        referrer: null,
        search: null,
      }),
    ).toEqual({ path: "/pricing" });
  });

  it("omits the current browser path unless explicitly enabled", () => {
    installLocation(
      "https:",
      "tryintern.dev",
      "/invite/short-code",
      "?token=secret",
    );

    expect(safeBrowserAnalyticsProperties({ referrer: null })).toEqual({});
  });

  it("redacts token-like browser path segments when current path is enabled", () => {
    installLocation(
      "https:",
      "tryintern.dev",
      "/users/018f36c0-3d9a-7cc2-a7e9-3c7c4d91d3aa/tokens/abc123def456ghi789jkl",
      "?token=secret",
    );

    expect(
      safeBrowserAnalyticsProperties({
        includeCurrentPath: true,
        referrer: null,
        search: null,
      }),
    ).toEqual({
      path: "/users/:redacted/tokens/:redacted",
    });
  });

  it("redacts token-like explicit path segments by default", () => {
    expect(
      safeBrowserAnalyticsProperties({
        path: "/users/018f36c0-3d9a-7cc2-a7e9-3c7c4d91d3aa/tokens/abc123def456ghi789jkl",
        referrer: null,
        search: null,
      }),
    ).toEqual({
      path: "/users/:redacted/tokens/:redacted",
    });
  });

  it("lets callers pass an already-safe route pattern", () => {
    expect(
      safeBrowserAnalyticsProperties({
        path: "/users/:userId/tokens/:tokenId",
        redactPathSegments: false,
        referrer: null,
        search: null,
      }),
    ).toEqual({
      path: "/users/:userId/tokens/:tokenId",
    });
  });

  it("omits malformed referrers instead of sending raw fallback values", () => {
    expect(
      safeBrowserAnalyticsProperties({
        path: null,
        referrer: "not a url with token=secret",
        search: null,
      }),
    ).toEqual({});
  });

  it("supports caller-owned query allowlists and truncates values", () => {
    expect(
      safeBrowserAnalyticsProperties({
        path: null,
        referrer: "https://docs.example/path?token=secret",
        search: new URLSearchParams({
          utm_source: "newsletter",
          campaign_id: "abcdef",
          token: "secret",
        }),
        allowedSearchParams: ["campaign_id"],
        maxValueLength: 4,
      }),
    ).toEqual({
      referrer: "docs",
      campaign_id: "abcd",
    });
  });

  it("returns empty context outside the browser", () => {
    expect(safeBrowserAnalyticsProperties()).toEqual({});
  });
});
