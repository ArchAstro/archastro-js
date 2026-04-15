import { cookies } from "next/headers";
import { PlatformClient, AuthClient, type AuthTokens, type User } from "@archastro/sdk";

export interface NextJSSessionConfig {
  apiBaseURL: string;
  publishableKey: string;
  session: {
    cookieName: string;
  };
}

export interface SessionTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  user?: User | null;
}

export interface NextJSSessionManager {
  getServerClient(): Promise<PlatformClient | null>;
  establishSession(oneTimeToken: string): Promise<SessionTokens | null>;
  establishSessionFromPassword(email: string, password: string): Promise<SessionTokens | null>;
  establishSessionFromRegistration(params: { email: string; password?: string; alias?: string; full_name?: string }): Promise<SessionTokens | null>;
  establishSessionFromCode(email: string, code: string): Promise<SessionTokens | null>;
  refreshSession(): Promise<SessionTokens | null>;
  clearSession(): Promise<void>;
}

async function readCookie(cookieName: string): Promise<string | undefined> {
  try {
    const jar = await cookies();
    return jar.get(cookieName)?.value;
  } catch {
    return undefined;
  }
}

async function writeCookie(cookieName: string, value: string): Promise<void> {
  try {
    const jar = await cookies();
    jar.set({
      name: cookieName,
      value,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
  } catch {
    console.warn("Cannot write cookie outside server action context");
  }
}

async function clearCookie(cookieName: string): Promise<void> {
  try {
    const jar = await cookies();
    jar.delete(cookieName);
  } catch {
    console.warn("Cannot clear cookie outside server action context");
  }
}

function encodeSessionCookie(tokens: AuthTokens): string {
  return JSON.stringify({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenExpiry: tokens.tokenExpiry,
  });
}

function decodeSessionCookie(value: string): AuthTokens | null {
  try {
    const parsed = JSON.parse(value);
    if (!parsed.accessToken) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      tokenExpiry: parsed.tokenExpiry,
    };
  } catch {
    return null;
  }
}

export function createSessionManager(config: NextJSSessionConfig): NextJSSessionManager {
  const { apiBaseURL, publishableKey, session: { cookieName } } = config;

  function makeClient(accessToken?: string): PlatformClient {
    return new PlatformClient({
      baseUrl: apiBaseURL,
      accessToken,
      defaultHeaders: { "x-archastro-api-key": publishableKey },
    });
  }

  function makeAuthClient(): AuthClient {
    const client = makeClient();
    return client.auth;
  }

  async function getServerClient(): Promise<PlatformClient | null> {
    const cookieValue = await readCookie(cookieName);
    if (!cookieValue) return null;

    const tokens = decodeSessionCookie(cookieValue);
    if (!tokens?.accessToken) return null;

    return makeClient(tokens.accessToken);
  }

  async function storeAndReturn(tokens: AuthTokens): Promise<SessionTokens | null> {
    if (!tokens.accessToken) return null;

    await writeCookie(cookieName, encodeSessionCookie(tokens));

    // Try to fetch the current user
    let user: User | null = null;
    try {
      const client = makeClient(tokens.accessToken);
      const me = await client.users.me();
      user = me as User;
    } catch {
      // Not critical — return tokens without user
    }

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.tokenExpiry,
      user,
    };
  }

  async function establishSession(oneTimeToken: string): Promise<SessionTokens | null> {
    try {
      const auth = makeAuthClient();
      const tokens = await auth.exchangeLoginToken(oneTimeToken);
      return storeAndReturn(tokens);
    } catch {
      return null;
    }
  }

  async function establishSessionFromPassword(email: string, password: string): Promise<SessionTokens | null> {
    try {
      const auth = makeAuthClient();
      const tokens = await auth.login(email, password);
      return storeAndReturn(tokens);
    } catch {
      return null;
    }
  }

  async function establishSessionFromRegistration(params: { email: string; password?: string; alias?: string; full_name?: string }): Promise<SessionTokens | null> {
    try {
      const auth = makeAuthClient();
      const tokens = await auth.register(params.email, params.alias, params.full_name, undefined, params.password);
      return storeAndReturn(tokens);
    } catch {
      return null;
    }
  }

  async function establishSessionFromCode(_email: string, code: string): Promise<SessionTokens | null> {
    // Login codes use the same token exchange endpoint
    try {
      const auth = makeAuthClient();
      const tokens = await auth.exchangeLoginToken(code);
      return storeAndReturn(tokens);
    } catch {
      return null;
    }
  }

  async function refreshSession(): Promise<SessionTokens | null> {
    const cookieValue = await readCookie(cookieName);
    if (!cookieValue) return null;

    const stored = decodeSessionCookie(cookieValue);
    if (!stored?.refreshToken) return null;

    try {
      const auth = makeAuthClient();
      const tokens = await auth.refresh(stored.refreshToken);
      return storeAndReturn(tokens);
    } catch {
      return null;
    }
  }

  async function clearSession(): Promise<void> {
    await clearCookie(cookieName);
  }

  return {
    getServerClient,
    establishSession,
    establishSessionFromPassword,
    establishSessionFromRegistration,
    establishSessionFromCode,
    refreshSession,
    clearSession,
  };
}
