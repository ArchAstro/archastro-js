import { describe, it, expect } from "vitest";
import {
  getExternalBaseUrlFromRequest,
  getPathname,
  getSearchParams,
  type RequestWithHeaders,
  type NextRequestLike,
} from "../request-helpers.js";

/**
 * Create a mock request with headers
 */
function createMockRequest(
  url: string,
  headers: Record<string, string> = {}
): RequestWithHeaders {
  return {
    url,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  };
}

/**
 * Create a mock NextRequest-like object with nextUrl
 */
function createMockNextRequest(
  url: string,
  headers: Record<string, string> = {}
): NextRequestLike {
  const parsedUrl = new URL(url);
  return {
    url,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    nextUrl: {
      origin: parsedUrl.origin,
      pathname: parsedUrl.pathname,
      searchParams: parsedUrl.searchParams,
    },
  };
}

describe("getExternalBaseUrlFromRequest", () => {
  describe("with forwarded headers", () => {
    it("uses x-forwarded-host and x-forwarded-proto headers", () => {
      const request = createMockRequest("http://localhost:8080/auth/callback", {
        "x-forwarded-host": "myapp.example.com",
        "x-forwarded-proto": "https",
      });

      const result = getExternalBaseUrlFromRequest(request);

      expect(result.toString()).toBe("https://myapp.example.com/");
    });

    it("defaults to https when x-forwarded-proto is missing", () => {
      const request = createMockRequest("http://localhost:8080/auth/callback", {
        "x-forwarded-host": "myapp.example.com",
      });

      const result = getExternalBaseUrlFromRequest(request);

      expect(result.toString()).toBe("https://myapp.example.com/");
    });

    it("respects http protocol from x-forwarded-proto", () => {
      const request = createMockRequest("http://localhost:8080/auth/callback", {
        "x-forwarded-host": "dev.example.com",
        "x-forwarded-proto": "http",
      });

      const result = getExternalBaseUrlFromRequest(request);

      expect(result.toString()).toBe("http://dev.example.com/");
    });
  });

  describe("without forwarded headers", () => {
    it("uses fallback URL when provided as string", () => {
      const request = createMockRequest("http://localhost:8080/auth/callback");

      const result = getExternalBaseUrlFromRequest(
        request,
        "https://fallback.example.com"
      );

      expect(result.toString()).toBe("https://fallback.example.com/");
    });

    it("uses fallback URL when provided as URL object", () => {
      const request = createMockRequest("http://localhost:8080/auth/callback");
      const fallback = new URL("https://fallback.example.com");

      const result = getExternalBaseUrlFromRequest(request, fallback);

      expect(result.toString()).toBe("https://fallback.example.com/");
    });

    it("uses nextUrl.origin when available (NextRequest)", () => {
      const request = createMockNextRequest(
        "http://localhost:8080/auth/callback?token=abc"
      );

      const result = getExternalBaseUrlFromRequest(request);

      expect(result.toString()).toBe("http://localhost:8080/");
    });

    it("parses origin from request.url as last resort", () => {
      const request = createMockRequest(
        "http://internal-server:3000/auth/callback"
      );

      const result = getExternalBaseUrlFromRequest(request);

      expect(result.toString()).toBe("http://internal-server:3000/");
    });
  });

  describe("priority order", () => {
    it("prefers forwarded headers over fallback", () => {
      const request = createMockRequest("http://localhost:8080/callback", {
        "x-forwarded-host": "production.example.com",
        "x-forwarded-proto": "https",
      });

      const result = getExternalBaseUrlFromRequest(
        request,
        "https://fallback.example.com"
      );

      expect(result.toString()).toBe("https://production.example.com/");
    });

    it("prefers forwarded headers over nextUrl", () => {
      const request = createMockNextRequest(
        "http://localhost:8080/callback",
        {
          "x-forwarded-host": "production.example.com",
          "x-forwarded-proto": "https",
        }
      );

      const result = getExternalBaseUrlFromRequest(request);

      expect(result.toString()).toBe("https://production.example.com/");
    });
  });
});

describe("getPathname", () => {
  it("extracts pathname from NextRequest using nextUrl", () => {
    const request = createMockNextRequest(
      "http://localhost:8080/auth/callback?token=abc"
    );

    const result = getPathname(request);

    expect(result).toBe("/auth/callback");
  });

  it("extracts pathname from regular Request using url", () => {
    const request = createMockRequest(
      "http://localhost:8080/api/users?page=1"
    );

    const result = getPathname(request);

    expect(result).toBe("/api/users");
  });

  it("handles root path", () => {
    const request = createMockNextRequest("http://localhost:8080/");

    const result = getPathname(request);

    expect(result).toBe("/");
  });

  it("handles paths with special characters", () => {
    const request = createMockNextRequest(
      "http://localhost:8080/users/john%20doe/profile"
    );

    const result = getPathname(request);

    expect(result).toBe("/users/john%20doe/profile");
  });
});

describe("getSearchParams", () => {
  it("extracts search params from NextRequest using nextUrl", () => {
    const request = createMockNextRequest(
      "http://localhost:8080/auth/callback?token=abc123&next=/dashboard"
    );

    const result = getSearchParams(request);

    expect(result.get("token")).toBe("abc123");
    expect(result.get("next")).toBe("/dashboard");
  });

  it("extracts search params from regular Request using url", () => {
    const request = createMockRequest(
      "http://localhost:8080/api/search?q=test&page=2"
    );

    const result = getSearchParams(request);

    expect(result.get("q")).toBe("test");
    expect(result.get("page")).toBe("2");
  });

  it("returns empty URLSearchParams when no query string", () => {
    const request = createMockNextRequest("http://localhost:8080/auth/callback");

    const result = getSearchParams(request);

    expect(result.toString()).toBe("");
    expect(result.get("token")).toBeNull();
  });

  it("handles multiple values for same parameter", () => {
    const request = createMockNextRequest(
      "http://localhost:8080/api?tag=a&tag=b&tag=c"
    );

    const result = getSearchParams(request);

    expect(result.getAll("tag")).toEqual(["a", "b", "c"]);
  });

  it("handles encoded values", () => {
    const request = createMockNextRequest(
      "http://localhost:8080/search?q=hello%20world&redirect=https%3A%2F%2Fexample.com"
    );

    const result = getSearchParams(request);

    expect(result.get("q")).toBe("hello world");
    expect(result.get("redirect")).toBe("https://example.com");
  });
});
