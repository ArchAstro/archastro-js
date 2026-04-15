"use client";

import {
  useCallback,
  useEffect,
  useState,
  useRef,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { PlatformClient, type User } from "@archastro/sdk";
import { Socket } from "@archastro/sdk/dist/phx_channel/socket.js";
import type { SessionRefreshResult } from "../server/auth-actions.js";

interface ClientContextValue {
  client: PlatformClient;
  socket: Socket;
  refreshSession: () => Promise<SessionRefreshResult | null>;
}

const ClientContext = createContext<ClientContextValue | null>(null);

export interface SDKClientConfig {
  baseURL: string;
  publishableKey: string;
}

export interface SDKProviderProps {
  children: ReactNode;
  initialAccessToken?: string | null;
  config: SDKClientConfig;
  refreshSession: () => Promise<SessionRefreshResult | null>;
  onAuthExpired?: () => void;
}

/**
 * Provider component that initializes the SDK client.
 * Wrap your app with this to enable client-side SDK access.
 */
export function SDKProvider({
  children,
  initialAccessToken,
  config,
  refreshSession,
  onAuthExpired,
}: SDKProviderProps) {
  const refreshSessionRef = useRef(refreshSession);
  refreshSessionRef.current = refreshSession;

  const onAuthExpiredRef = useRef(onAuthExpired);
  onAuthExpiredRef.current = onAuthExpired;

  const [value] = useState<ClientContextValue>(() => {
    const client = new PlatformClient({
      baseUrl: config.baseURL,
      accessToken: initialAccessToken ?? undefined,
      defaultHeaders: { "x-archastro-api-key": config.publishableKey },
      onRefreshToken: async () => {
        const result = await refreshSessionRef.current();
        if (!result?.accessToken) {
          if (onAuthExpiredRef.current) {
            onAuthExpiredRef.current();
          } else if (typeof window !== "undefined") {
            window.location.href = "/login";
          }
          throw new Error("Session expired");
        }
        return result.accessToken;
      },
    });

    const wsUrl = config.baseURL.replace(/^http/, "ws") + "/socket/websocket";
    const socket = new Socket(wsUrl, {
      params: {
        token: initialAccessToken ?? "",
        api_key: config.publishableKey,
      },
    });

    return { client, socket, refreshSession };
  });

  useEffect(() => {
    value.socket.connect().catch(console.error);
    return () => {
      value.socket.disconnect().catch(console.error);
    };
  }, [value.socket]);

  return (
    <ClientContext.Provider value={value}>{children}</ClientContext.Provider>
  );
}

/**
 * Low-level provider that sets the SDK client context without creating a new client.
 * Use this when you manage your own PlatformClient instance and need SDK components
 * (like ChatThread) to find it via context.
 */
export function ClientProvider({
  client,
  socket,
  refreshSession,
  children,
}: {
  client: PlatformClient;
  socket: Socket;
  refreshSession: () => Promise<SessionRefreshResult | null>;
  children: ReactNode;
}) {
  return (
    <ClientContext.Provider value={{ client, socket, refreshSession }}>
      {children}
    </ClientContext.Provider>
  );
}

/**
 * Hook to get the SDK client.
 * Must be used within an SDKProvider.
 */
export function useClient(): PlatformClient {
  const ctx = useContext(ClientContext);
  if (!ctx) {
    throw new Error("useClient must be used within an SDKProvider");
  }
  return ctx.client;
}

/**
 * Hook to get the WebSocket instance.
 */
export function useSocket(): Socket {
  const ctx = useContext(ClientContext);
  if (!ctx) {
    throw new Error("useSocket must be used within an SDKProvider");
  }
  return ctx.socket;
}

/**
 * Hook to get the current user.
 * Returns null if not authenticated.
 */
export function useCurrentUser(): User | null {
  const client = useClient();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.users.me().then((me) => {
      if (!cancelled) setUser(me);
    }).catch(() => {
      if (!cancelled) setUser(null);
    });
    return () => { cancelled = true; };
  }, [client]);

  return user;
}

/**
 * Hook to refresh the session.
 * Call this after login to update the client state.
 */
export function useRefreshSession() {
  const ctx = useContext(ClientContext);
  if (!ctx) {
    throw new Error("useRefreshSession must be used within an SDKProvider");
  }

  const { client, refreshSession } = ctx;

  return useCallback(async () => {
    const result = await refreshSession();
    if (result?.accessToken) {
      client.setAccessToken(result.accessToken);
    }
  }, [client, refreshSession]);
}

/**
 * Hook to log out the current user.
 * Clears client-side state. Caller should handle server-side logout separately.
 */
export function useLogout() {
  return useCallback(async () => {
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
  }, []);
}
