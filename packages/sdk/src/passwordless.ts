/**
 * Passwordless email-code auth (hand-maintained).
 *
 * Complements generated AuthClient magic-link methods with the OTP code flow
 * used by native mobile clients (see helpers RN + platform
 * `/auth/register/code`, `/auth/login/code`, `/auth/code/verify`).
 */
import type { HttpClient } from "./runtime/http-client.js";
import type { AuthTokens } from "./auth.js";

export interface PasswordlessRegisterInput {
  email: string;
  full_name?: string;
  alias?: string;
  timezone?: string;
}

export interface PasswordlessLoginCodeInput {
  email: string;
}

export interface PasswordlessVerifyCodeInput {
  email: string;
  code: string;
  timezone?: string;
}

function mapTokens(data: Record<string, unknown>): AuthTokens {
  return {
    tokenExpiry: data.expires_in as number | undefined,
    refreshToken: data.refresh_token as string | undefined,
    accessToken:
      (data.token as string | undefined) ??
      (data.access_token as string | undefined),
  };
}

export function extractUserFromAuthResponse(
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const user = data.user;
  if (user && typeof user === "object") {
    return user as Record<string, unknown>;
  }
  return null;
}

/**
 * Hand-maintained passwordless helpers bound to an HttpClient
 * (typically `client.http` with a publishable key header set).
 */
export class PasswordlessAuth {
  constructor(private http: HttpClient) {}

  /**
   * Start passwordless registration (sends email code).
   * Existing accounts may return 409/422 — callers should fall back to
   * {@link requestLoginCode}.
   */
  async register(input: PasswordlessRegisterInput): Promise<void> {
    const body: Record<string, unknown> = {
      email: input.email,
    };
    if (input.full_name !== undefined) body.full_name = input.full_name;
    if (input.alias !== undefined) body.alias = input.alias;
    if (input.timezone !== undefined) body.timezone = input.timezone;

    await this.http.request("/api/v1/auth/register/code", {
      method: "POST",
      body,
    });
  }

  /** Request a one-time login code for an existing user. */
  async requestLoginCode(input: PasswordlessLoginCodeInput): Promise<void> {
    await this.http.request("/api/v1/auth/login/code", {
      method: "POST",
      body: { email: input.email },
    });
  }

  /**
   * Verify email + code and return session tokens (+ raw user when present).
   */
  async verifyCode(input: PasswordlessVerifyCodeInput): Promise<{
    tokens: AuthTokens;
    user: Record<string, unknown> | null;
    raw: Record<string, unknown>;
  }> {
    const body: Record<string, unknown> = {
      email: input.email,
      code: input.code,
    };
    if (input.timezone !== undefined) body.timezone = input.timezone;

    const data = await this.http.request<Record<string, unknown>>(
      "/api/v1/auth/code/verify",
      { method: "POST", body },
    );
    return {
      tokens: mapTokens(data),
      user: extractUserFromAuthResponse(data),
      raw: data,
    };
  }
}
