// Copyright (c) 2025 ArchAstro Inc. All Rights Reserved.

import { headers } from "next/headers";
import { redirect } from "next/navigation";

export type FederatedProvider = "google" | "github";

export interface FederatedAuthConfig {
  apiBaseUrl: string;
  /** Publishable API key (pk_*) to identify the app */
  publishableKey: string;
}

export interface StartFederatedLoginOptions {
  /** Path to redirect to after auth. Defaults to /auth/callback */
  callbackPath?: string;
  /** Fallback origin if forwarded headers unavailable */
  fallbackOrigin?: string;
}

/**
 * Get the external base URL using forwarded headers (for K8s/proxy environments).
 */
export async function getExternalBaseUrl(fallbackOrigin?: string): Promise<URL> {
  const headersList = await headers();
  const forwardedHost = headersList.get("x-forwarded-host");
  const forwardedProto = headersList.get("x-forwarded-proto") || "https";

  if (forwardedHost) {
    return new URL(`${forwardedProto}://${forwardedHost}`);
  }

  if (fallbackOrigin) {
    return new URL(fallbackOrigin);
  }

  // Last resort: try to get from host header
  const host = headersList.get("host");
  if (host) {
    return new URL(`https://${host}`);
  }

  throw new Error(
    "Cannot determine external URL: no x-forwarded-host or host header and no fallback provided"
  );
}

/**
 * Create federated auth helpers bound to config.
 */
export function createFederatedAuth(config: FederatedAuthConfig) {
  const { apiBaseUrl, publishableKey } = config;

  /**
   * Start federated login flow from a server action.
   * Constructs redirect URI using forwarded headers and redirects to provider.
   */
  async function startFederatedLogin(
    provider: FederatedProvider,
    options: StartFederatedLoginOptions = {}
  ): Promise<never> {
    const { callbackPath = "/auth/callback", fallbackOrigin } = options;

    const baseUrl = await getExternalBaseUrl(fallbackOrigin);
    const redirectUri = new URL(callbackPath, baseUrl).toString();

    const params = new URLSearchParams({
      redirect_uri: redirectUri,
      api_key: publishableKey,
    });
    const url = `${apiBaseUrl}/auth/federated/${provider}/authorize?${params}`;

    redirect(url);
  }

  /**
   * Get supported federated providers.
   */
  function getSupportedProviders(): FederatedProvider[] {
    return ["google", "github"];
  }

  return {
    startFederatedLogin,
    getSupportedProviders,
    getExternalBaseUrl,
  };
}
