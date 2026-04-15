import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCookieJar = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => mockCookieJar),
}));

const mockExchangeLoginToken = vi.fn();
const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockRefresh = vi.fn();
const mockUsersMe = vi.fn();

vi.mock("@archastro/sdk", () => {
  return {
    PlatformClient: class MockPlatformClient {
      auth = {
        exchangeLoginToken: mockExchangeLoginToken,
        login: mockLogin,
        register: mockRegister,
        refresh: mockRefresh,
      };
      users = { me: mockUsersMe };
      http = { request: vi.fn() };
    },
    AuthClient: class MockAuthClient {},
  };
});

import { createSessionManager } from "../session-manager.js";

const config = {
  apiBaseURL: "https://api.example.com",
  publishableKey: "pk_test_123",
  session: { cookieName: "test_session" },
};

const mockUser = { id: "user-1", email: "test@example.com", name: "Test", alias: null };

describe("createSessionManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getServerClient", () => {
    it("returns null when no cookie exists", async () => {
      mockCookieJar.get.mockReturnValue(undefined);
      const mgr = createSessionManager(config);
      expect(await mgr.getServerClient()).toBeNull();
    });

    it("returns null when cookie has no access token", async () => {
      mockCookieJar.get.mockReturnValue({ value: JSON.stringify({ refreshToken: "rt" }) });
      const mgr = createSessionManager(config);
      expect(await mgr.getServerClient()).toBeNull();
    });

    it("returns a PlatformClient when cookie has valid tokens", async () => {
      mockCookieJar.get.mockReturnValue({
        value: JSON.stringify({ accessToken: "at-123", refreshToken: "rt-456" }),
      });
      const mgr = createSessionManager(config);
      const client = await mgr.getServerClient();
      expect(client).not.toBeNull();
    });
  });

  describe("establishSession", () => {
    it("exchanges token and stores cookie", async () => {
      mockExchangeLoginToken.mockResolvedValue({
        accessToken: "new-at",
        refreshToken: "new-rt",
        tokenExpiry: 3600,
      });
      mockUsersMe.mockResolvedValue(mockUser);

      const mgr = createSessionManager(config);
      const result = await mgr.establishSession("one-time-token");

      expect(result).not.toBeNull();
      expect(result!.accessToken).toBe("new-at");
      expect(result!.user).toEqual(mockUser);
      expect(mockCookieJar.set).toHaveBeenCalled();
      const cookieCall = mockCookieJar.set.mock.calls[0][0];
      expect(cookieCall.name).toBe("test_session");
      expect(JSON.parse(cookieCall.value).accessToken).toBe("new-at");
    });

    it("returns null when exchange fails", async () => {
      mockExchangeLoginToken.mockRejectedValue(new Error("bad token"));
      const mgr = createSessionManager(config);
      expect(await mgr.establishSession("bad-token")).toBeNull();
    });
  });

  describe("establishSessionFromPassword", () => {
    it("logs in and stores cookie", async () => {
      mockLogin.mockResolvedValue({
        accessToken: "at-pw",
        refreshToken: "rt-pw",
        tokenExpiry: 7200,
      });
      mockUsersMe.mockResolvedValue(mockUser);

      const mgr = createSessionManager(config);
      const result = await mgr.establishSessionFromPassword("a@b.com", "pw");

      expect(result).not.toBeNull();
      expect(result!.accessToken).toBe("at-pw");
    });

    it("returns null on bad credentials", async () => {
      mockLogin.mockRejectedValue(new Error("unauthorized"));
      const mgr = createSessionManager(config);
      expect(await mgr.establishSessionFromPassword("a@b.com", "bad")).toBeNull();
    });
  });

  describe("establishSessionFromRegistration", () => {
    it("registers and stores cookie", async () => {
      mockRegister.mockResolvedValue({
        accessToken: "at-reg",
        refreshToken: "rt-reg",
        tokenExpiry: 3600,
      });
      mockUsersMe.mockResolvedValue(mockUser);

      const mgr = createSessionManager(config);
      const result = await mgr.establishSessionFromRegistration({
        email: "new@user.com",
        password: "pass",
        alias: "newuser",
        full_name: "New User",
      });

      expect(result).not.toBeNull();
      expect(result!.accessToken).toBe("at-reg");
    });
  });

  describe("refreshSession", () => {
    it("refreshes tokens from stored cookie", async () => {
      mockCookieJar.get.mockReturnValue({
        value: JSON.stringify({ accessToken: "old-at", refreshToken: "old-rt", tokenExpiry: 100 }),
      });
      mockRefresh.mockResolvedValue({
        accessToken: "new-at",
        refreshToken: "new-rt",
        tokenExpiry: 3600,
      });
      mockUsersMe.mockResolvedValue(mockUser);

      const mgr = createSessionManager(config);
      const result = await mgr.refreshSession();

      expect(result).not.toBeNull();
      expect(result!.accessToken).toBe("new-at");
      expect(result!.user).toEqual(mockUser);
    });

    it("returns null when no cookie exists", async () => {
      mockCookieJar.get.mockReturnValue(undefined);
      const mgr = createSessionManager(config);
      expect(await mgr.refreshSession()).toBeNull();
    });

    it("returns null when no refresh token in cookie", async () => {
      mockCookieJar.get.mockReturnValue({
        value: JSON.stringify({ accessToken: "at" }),
      });
      const mgr = createSessionManager(config);
      expect(await mgr.refreshSession()).toBeNull();
    });

    it("returns null when refresh API fails", async () => {
      mockCookieJar.get.mockReturnValue({
        value: JSON.stringify({ accessToken: "at", refreshToken: "rt" }),
      });
      mockRefresh.mockRejectedValue(new Error("expired"));
      const mgr = createSessionManager(config);
      expect(await mgr.refreshSession()).toBeNull();
    });
  });

  describe("clearSession", () => {
    it("deletes the cookie", async () => {
      const mgr = createSessionManager(config);
      await mgr.clearSession();
      expect(mockCookieJar.delete).toHaveBeenCalledWith("test_session");
    });
  });
});
