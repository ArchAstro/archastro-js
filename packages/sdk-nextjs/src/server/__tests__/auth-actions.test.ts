import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock cookie jar
const mockCookieJar = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => mockCookieJar),
}));

// Mock AuthClient methods
const mockExchangeLoginToken = vi.fn();
const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockRefresh = vi.fn();

// Mock users.me()
const mockUsersMe = vi.fn();

// Mock PlatformClient — session-manager creates multiple instances, all share mock fns
vi.mock("@archastro/sdk", () => {
  return {
    PlatformClient: class MockPlatformClient {
      auth = {
        exchangeLoginToken: mockExchangeLoginToken,
        login: mockLogin,
        register: mockRegister,
        refresh: mockRefresh,
      };
      users = {
        me: mockUsersMe,
      };
      http = {
        request: vi.fn(),
      };
    },
    AuthClient: class MockAuthClient {},
  };
});

import { createAuthActions } from "../auth-actions.js";

const mockConfig = {
  apiBaseURL: "https://api.example.com",
  publishableKey: "pk_test_123",
  session: {
    cookieName: "test_session",
  },
};

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  name: "Test User",
  alias: null,
  profile_picture: null,
};

describe("createAuthActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleMagicLink", () => {
    it("returns success when token exchange succeeds", async () => {
      mockExchangeLoginToken.mockResolvedValue({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        tokenExpiry: 3600,
      });
      mockUsersMe.mockResolvedValue(mockUser);

      const actions = createAuthActions(mockConfig);
      const result = await actions.handleMagicLink("valid-token");

      expect(result).toEqual({
        success: true,
        user: mockUser,
      });
    });

    it("returns error when token fails and no existing session", async () => {
      mockExchangeLoginToken.mockRejectedValue(new Error("invalid token"));
      mockCookieJar.get.mockReturnValue(undefined);

      const actions = createAuthActions(mockConfig);
      const result = await actions.handleMagicLink("invalid-token");

      expect(result).toEqual({
        success: false,
        error: "Invalid or expired token",
      });
    });

    it("returns success with existing user when token fails but session exists", async () => {
      mockExchangeLoginToken.mockRejectedValue(new Error("already claimed"));
      // Cookie has a stored session with a refresh token
      mockCookieJar.get.mockReturnValue({
        value: JSON.stringify({
          accessToken: "old-access",
          refreshToken: "old-refresh",
          tokenExpiry: 3600,
        }),
      });
      mockRefresh.mockResolvedValue({
        accessToken: "refreshed-access",
        refreshToken: "refreshed-refresh",
        tokenExpiry: 3600,
      });
      mockUsersMe.mockResolvedValue(mockUser);

      const actions = createAuthActions(mockConfig);
      const result = await actions.handleMagicLink("already-claimed-token");

      expect(result).toEqual({
        success: true,
        user: mockUser,
      });
    });
  });

  describe("verifyLoginCode", () => {
    it("returns success when code verification succeeds", async () => {
      mockExchangeLoginToken.mockResolvedValue({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        tokenExpiry: 3600,
      });
      mockUsersMe.mockResolvedValue(mockUser);

      const actions = createAuthActions(mockConfig);
      const result = await actions.verifyLoginCode("test@example.com", "123456");

      expect(result).toEqual({
        success: true,
        user: mockUser,
      });
    });

    it("returns error when code fails and no existing session", async () => {
      mockExchangeLoginToken.mockRejectedValue(new Error("invalid code"));
      mockCookieJar.get.mockReturnValue(undefined);

      const actions = createAuthActions(mockConfig);
      const result = await actions.verifyLoginCode("test@example.com", "wrong-code");

      expect(result).toEqual({
        success: false,
        error: "Invalid or expired code",
      });
    });

    it("returns success with existing user when code fails but session exists", async () => {
      mockExchangeLoginToken.mockRejectedValue(new Error("already used"));
      mockCookieJar.get.mockReturnValue({
        value: JSON.stringify({
          accessToken: "old-access",
          refreshToken: "old-refresh",
          tokenExpiry: 3600,
        }),
      });
      mockRefresh.mockResolvedValue({
        accessToken: "refreshed-access",
        refreshToken: "refreshed-refresh",
        tokenExpiry: 3600,
      });
      mockUsersMe.mockResolvedValue(mockUser);

      const actions = createAuthActions(mockConfig);
      const result = await actions.verifyLoginCode("test@example.com", "already-used-code");

      expect(result).toEqual({
        success: true,
        user: mockUser,
      });
    });
  });

  describe("refreshSession", () => {
    it("returns session data when refresh succeeds", async () => {
      mockCookieJar.get.mockReturnValue({
        value: JSON.stringify({
          accessToken: "old-access",
          refreshToken: "old-refresh",
          tokenExpiry: 3600,
        }),
      });
      mockRefresh.mockResolvedValue({
        accessToken: "new-access-token",
        refreshToken: "new-refresh",
        tokenExpiry: 3600,
      });
      mockUsersMe.mockResolvedValue(mockUser);

      const actions = createAuthActions(mockConfig);
      const result = await actions.refreshSession();

      expect(result).toEqual({
        accessToken: "new-access-token",
        tokenType: "Bearer",
        expiresIn: 3600,
        user: mockUser,
      });
    });

    it("returns null when no session cookie exists", async () => {
      mockCookieJar.get.mockReturnValue(undefined);

      const actions = createAuthActions(mockConfig);
      const result = await actions.refreshSession();

      expect(result).toBeNull();
    });
  });

  describe("logout", () => {
    it("clears the session cookie", async () => {
      const actions = createAuthActions(mockConfig);
      await actions.logout();

      expect(mockCookieJar.delete).toHaveBeenCalledWith("test_session");
    });
  });
});
