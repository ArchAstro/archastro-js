/**
 * Durable user-session mode for PlatformClient (hand-maintained).
 *
 * Use `PlatformClient.forApp({ publishableKey, storage, baseUrl })` for native
 * / SPA clients. Session state, passwordless OTP, auto-refresh, and optional
 * socket helpers live on the returned client — not a parallel SessionClient.
 */
import { AuthClient, type AuthTokens } from "./auth.js";
import { PlatformClient } from "./client.js";
import { HttpClient } from "./runtime/http-client.js";
import { PasswordlessAuth } from "./passwordless.js";
import {
  createPlatformSocket,
  type PlatformSocketOptions,
} from "./platform-socket.js";
import type { Socket, SocketConfig } from "./phx_channel/socket.js";

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

export interface ForAppOptions {
  /** Publishable key (pk_...) sent as x-archastro-api-key */
  publishableKey: string;
  /** Platform origin; defaults to production */
  baseUrl?: string;
  /** Durable token store (SecureStore, AsyncStorage, memory, …) */
  storage: SessionStorage;
}

/**
 * PlatformClient with app-session capabilities.
 * Still a real PlatformClient — all generated resources work.
 */
export type AppPlatformClient = PlatformClient & {
  readonly passwordless: PasswordlessAuth;
  /** Hydrate from storage and wire auto-refresh. Returns session if any. */
  restore(): Promise<StoredSession | null>;
  /** Apply tokens from a login/verify response and persist. */
  signIn(
    tokens: AuthTokens,
    user?: StoredSession["user"],
  ): Promise<StoredSession>;
  /** Clear memory + storage + client tokens. */
  signOut(): Promise<void>;
  getSession(): StoredSession | null;
  /**
   * Phoenix ApiSocket using the current access token + publishable key.
   * Throws if not signed in.
   */
  createSocket(
    socketConfig?: Omit<SocketConfig, "params">,
  ): Socket;
};

function wireRefresh(
  client: PlatformClient,
  publishableKey: string,
  baseUrl: string,
  onRotated: (tokens: AuthTokens) => void | Promise<void>,
): void {
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
    // Install the new access token first so a concurrent 401-retry that races
    // past onRotated still sends the fresh bearer.
    client.setAccessToken(refreshed.accessToken);
    if (refreshed.refreshToken) client.setRefreshToken(refreshed.refreshToken);
    // onRotated must not throw for persistence blips — callers treat any throw
    // as "refresh failed" and rethrow the original 401.
    await onRotated(refreshed);
    return refreshed.accessToken;
  });
}

function applyAccessAndRefresh(client: PlatformClient, tokens: AuthTokens): void {
  if (!tokens.accessToken) {
    throw new Error("Missing access token");
  }
  client.setAccessToken(tokens.accessToken);
  if (tokens.refreshToken) {
    client.setRefreshToken(tokens.refreshToken);
  }
}

/**
 * Client-side app factory: publishable key + durable session storage.
 *
 * Wires passwordless OTP, restore/signIn/signOut, 401 auto-refresh with
 * rotated-token persistence, and createSocket().
 */
export function forApp(options: ForAppOptions): AppPlatformClient {
  const { publishableKey, storage } = options;
  const baseUrl = (options.baseUrl ?? "https://platform.archastro.ai").replace(
    /\/+$/,
    "",
  );

  let current: StoredSession | null = null;

  const client = new PlatformClient({
    baseUrl,
    defaultHeaders: { "x-archastro-api-key": publishableKey },
    getAccessToken: () => current?.accessToken,
  });

  const passwordless = new PasswordlessAuth(client.http);

  const persistRotation = async (tokens: AuthTokens) => {
    if (!tokens.accessToken) return;

    // Rewrite in-memory session first so getAccessToken() returns the rotated
    // bearer for the HttpClient 401-retry, even if storage.save fails.
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
      console.warn(
        "[@archastro/sdk] failed to persist rotated session tokens",
        err,
      );
    }
  };

  const enableRefresh = (tokens: AuthTokens) => {
    applyAccessAndRefresh(client, tokens);
    wireRefresh(client, publishableKey, baseUrl, persistRotation);
  };

  const app = client as AppPlatformClient;

  Object.defineProperty(app, "passwordless", {
    value: passwordless,
    enumerable: true,
    writable: false,
  });

  app.getSession = () => current;

  app.restore = async () => {
    const stored = await storage.load();
    if (!stored?.accessToken) {
      current = null;
      return null;
    }
    // Without a refresh token the access token cannot be renewed — drop the
    // half-session so callers re-auth instead of looping 401s with no refresh.
    if (!stored.refreshToken) {
      current = null;
      await storage.clear().catch(() => undefined);
      return null;
    }
    current = stored;
    enableRefresh({
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      tokenExpiry: undefined,
    });
    return stored;
  };

  app.signIn = async (tokens, user) => {
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
    enableRefresh(tokens);
    await storage.save(session);
    return session;
  };

  app.signOut = async () => {
    current = null;
    client.setAccessToken("");
    client.setRefreshToken("");
    await storage.clear();
  };

  app.createSocket = (socketConfig) => {
    const accessToken = current?.accessToken;
    if (!accessToken) {
      throw new Error("Not signed in — call restore() or signIn() first");
    }
    const opts: PlatformSocketOptions = {
      apiBaseUrl: baseUrl,
      accessToken,
      publishableKey,
      socketConfig,
    };
    return createPlatformSocket(opts);
  };

  return app;
}
