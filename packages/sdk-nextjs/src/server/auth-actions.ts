import type { User } from "@archastro/sdk";
import { createSessionManager, type NextJSSessionConfig } from "./session-manager.js";

export interface AuthResult {
  success: boolean;
  error?: string;
  user?: User | null;
}

export interface SessionRefreshResult {
  accessToken: string;
  tokenType: string;
  expiresIn: number | null;
  user: User | null;
}

export interface RegisterParams {
  email: string;
  password: string;
  full_name: string;
  alias: string;
}

export interface AuthActions {
  register(params: RegisterParams): Promise<AuthResult>;
  loginWithPassword(email: string, password: string): Promise<AuthResult>;
  verifyLoginCode(email: string, code: string): Promise<AuthResult>;
  handleMagicLink(token: string): Promise<AuthResult>;
  logout(): Promise<void>;
  refreshSession(): Promise<SessionRefreshResult | null>;
}

export function createAuthActions(config: NextJSSessionConfig): AuthActions {
  const sessionManager = createSessionManager(config);

  async function register(params: RegisterParams): Promise<AuthResult> {
    const result = await sessionManager.establishSessionFromRegistration(params);

    if (!result) {
      return {
        success: false,
        error: "Registration failed. An account with this email may already exist.",
      };
    }

    return {
      success: true,
      user: result.user,
    };
  }

  async function loginWithPassword(email: string, password: string): Promise<AuthResult> {
    const result = await sessionManager.establishSessionFromPassword(email, password);

    if (!result) {
      return {
        success: false,
        error: "Invalid email or password",
      };
    }

    return {
      success: true,
      user: result.user,
    };
  }

  async function verifyLoginCode(email: string, code: string): Promise<AuthResult> {
    const result = await sessionManager.establishSessionFromCode(email, code);

    if (!result) {
      // Code verification failed (e.g., already used). Check if user already has
      // a valid session - if so, treat as success to avoid disrupting their session.
      const existingSession = await refreshSession();
      if (existingSession?.user) {
        return {
          success: true,
          user: existingSession.user,
        };
      }

      return {
        success: false,
        error: "Invalid or expired code",
      };
    }

    return {
      success: true,
      user: result.user,
    };
  }

  async function handleMagicLink(token: string): Promise<AuthResult> {
    const result = await sessionManager.establishSession(token);

    if (!result) {
      // Token exchange failed (e.g., already claimed). Check if user already has
      // a valid session - if so, treat as success to avoid disrupting their session.
      const existingSession = await refreshSession();
      if (existingSession?.user) {
        return {
          success: true,
          user: existingSession.user,
        };
      }

      return {
        success: false,
        error: "Invalid or expired token",
      };
    }

    return {
      success: true,
      user: result.user,
    };
  }

  async function logout(): Promise<void> {
    await sessionManager.clearSession();
  }

  async function refreshSession(): Promise<SessionRefreshResult | null> {
    const result = await sessionManager.refreshSession();

    if (!result) {
      return null;
    }

    return {
      accessToken: result.accessToken,
      tokenType: "Bearer",
      expiresIn: result.expiresIn ?? null,
      user: result.user ?? null,
    };
  }

  return {
    register,
    loginWithPassword,
    verifyLoginCode,
    handleMagicLink,
    logout,
    refreshSession,
  };
}
