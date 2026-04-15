const DEFAULT_LOCAL_API_BASE_URL = "http://localhost:4000";
const DEFAULT_PRODUCTION_API_BASE_URL = "https://platform.archastro.ai";

/**
 * Resolve the public API base URL from a NEXT_PUBLIC_* environment variable.
 *
 * Only reads the explicitly-public env var. Falls back to a hardcoded
 * public default (production URL or localhost) — never reads server-only
 * env vars like PHX_API_URL so the result is always safe to serialize
 * into the client payload via RuntimeConfigProvider.
 */
export function resolveApiBaseUrl(baseUrlEnvVar: string): string {
  const configuredBaseUrl = process.env[baseUrlEnvVar]?.trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  return process.env.NODE_ENV === "production"
    ? DEFAULT_PRODUCTION_API_BASE_URL
    : DEFAULT_LOCAL_API_BASE_URL;
}
