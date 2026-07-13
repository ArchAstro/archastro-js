/**
 * Session helpers for client-side apps (hand-maintained).
 *
 * Wires PlatformClient + publishable key + access/refresh token persistence
 * for React Native / browser. Mirrors the helpers RN TokenStorage pattern
 * without depending on the legacy AuthService class.
 */
import { AuthClient, type AuthTokens } from "./auth.js";
import { PlatformClient } from "./client.js";
import { HttpClient } from "./runtime/http-client.js";
import { PasswordlessAuth } from "./passwordless.js";
import { platformSocketUrl as buildPlatformSocketUrl } from "./runtime/url.js";

export interface StoredSession {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number | null;
  user?: {
    id: string;
    email?: string | null;
    name?: string | null;
    alias?: string | null;
    org?: string | null;
    org_name?: string | null;
    org_role?: string | null;
  } | null;
}

export interface SessionStorage {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

export interface SessionClientOptions {
  /** Platform origin, e.g. http://localhost:4005 */
  baseUrl: string;
  /** Publishable key (pk_...) sent as x-archastro-api-key */
  publishableKey: string;
  storage: SessionStorage;
}

export interface SessionClient {
  client: PlatformClient;
  passwordless: PasswordlessAuth;
  /** Hydrate from storage and wire auto-refresh. Returns session if any. */
  restore(): Promise<StoredSession | null>;
  /** Apply tokens from a login/verify response and persist. */
  establish(tokens: AuthTokens, user?: StoredSession["user"]): Promise<StoredSession>;
  clear(): Promise<void>;
  getSession(): StoredSession | null;
}

function applyTokens(
  client: PlatformClient,
  tokens: AuthTokens,
  publishableKey: string,
  baseUrl: string,
  onRotated: (tokens: AuthTokens) => void | Promise<void>,
): void {
  if (!tokens.accessToken) {
    throw new Error("Missing access token");
  }
  client.setAccessToken(tokens.accessToken);
  if (tokens.refreshToken) {
    client.setRefreshToken(tokens.refreshToken);
  }

  const refreshHttp = new HttpClient({
    baseUrl,
    defaultHeaders: { "x-archastro-api-key": publishableKey },
    refreshOnly: true,
  });
  const refreshAuth = new AuthClient(refreshHttp);

  client.http.setRefreshHandler(async () => {
    const rt = client.refreshToken;
    if (!rt) throw new Error("No refresh token available");
    const refreshed = await refreshAuth.refresh(rt);
    if (!refreshed.accessToken) {
      throw new Error("Refresh did not return an access token");
    }
    // Install the new access token on the HTTP client first so a concurrent
    // 401-retry that races past onRotated still sends the fresh bearer.
    client.setAccessToken(refreshed.accessToken);
    if (refreshed.refreshToken) client.setRefreshToken(refreshed.refreshToken);
    // onRotated must not throw for persistence blips — callers treat any
    // throw as "refresh failed" and rethrow the original 401.
    await onRotated(refreshed);
    return refreshed.accessToken;
  });
}

/**
 * Create a PlatformClient bound to session storage + passwordless helpers.
 * Suitable for React Native and browser SPAs.
 */
export function createSessionClient(options: SessionClientOptions): SessionClient {
  const { baseUrl, publishableKey, storage } = options;
  const normalizedBase = baseUrl.replace(/\/+$/, "");

  let current: StoredSession | null = null;

  const client = new PlatformClient({
    baseUrl: normalizedBase,
    defaultHeaders: { "x-archastro-api-key": publishableKey },
    getAccessToken: () => current?.accessToken,
  });

  const passwordless = new PasswordlessAuth(client.http);

  const persistRotation = async (tokens: AuthTokens) => {
    if (!tokens.accessToken) return;

    // Always rewrite in-memory session first so getAccessToken() returns the
    // rotated bearer for the HttpClient 401-retry, even if storage.save fails
    // (Expo SecureStore has a ~2KB limit and can reject large JWT blobs).
    const nextExpiresAt =
      typeof tokens.tokenExpiry === "number"
        ? Date.now() + tokens.tokenExpiry * 1000
        : (current?.accessTokenExpiresAt ?? null);

    current = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? current?.refreshToken,
      accessTokenExpiresAt: nextExpiresAt,
      user: current?.user ?? null,
    };

    try {
      await storage.save(current);
    } catch (err) {
      // Soft-fail: the process still has a valid rotated session. Failing the
      // refresh here would surface the original 401 and cause app code to
      // clear the session (useSession), wiping the good tokens.
      console.warn(
        "[@archastro/sdk] failed to persist rotated session tokens",
        err,
      );
    }
  };

  return {
    client,
    passwordless,
    getSession: () => current,

    async restore() {
      const stored = await storage.load();
      if (!stored?.accessToken) {
        current = null;
        return null;
      }
      // Without a refresh token the access token cannot be renewed — drop the
      // stale half-session so callers re-auth instead of looping 401s with no
      // /auth/refresh attempt (see HttpClient: no RT → refresh throws client-side).
      if (!stored.refreshToken) {
        current = null;
        await storage.clear().catch(() => undefined);
        return null;
      }
      current = stored;
      applyTokens(
        client,
        {
          accessToken: stored.accessToken,
          refreshToken: stored.refreshToken,
          tokenExpiry: undefined,
        },
        publishableKey,
        normalizedBase,
        persistRotation,
      );
      return stored;
    },

    async establish(tokens, user) {
      if (!tokens.accessToken) throw new Error("Missing access token");
      if (!tokens.refreshToken) {
        throw new Error(
          "Missing refresh token — session cannot auto-renew without one",
        );
      }
      const session: StoredSession = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt:
          typeof tokens.tokenExpiry === "number"
            ? Date.now() + tokens.tokenExpiry * 1000
            : null,
        user: user ?? current?.user ?? null,
      };
      current = session;
      applyTokens(client, tokens, publishableKey, normalizedBase, persistRotation);
      await storage.save(session);
      return session;
    },

    async clear() {
      current = null;
      // Drop bearer + refresh so a post-logout 401 cannot revive the session
      // via the still-wired refresh handler.
      client.setAccessToken("");
      client.setRefreshToken("");
      await storage.clear();
    },
  };
}

/**
 * Phoenix websocket URL for platform ApiSocket.
 * http(s)://host → ws(s)://host/socket/api/websocket
 * Hermes / React Native safe (no URL.protocol mutation).
 */
export function platformSocketUrl(apiBaseUrl: string): string {
  return buildPlatformSocketUrl(apiBaseUrl);
}
