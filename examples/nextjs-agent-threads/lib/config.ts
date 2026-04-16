import type { NextJSSessionConfig } from "@archastro/sdk-nextjs/server";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? "pk_dummy";

export interface PublicConfig {
  baseURL: string;
  publishableKey: string;
}

export function getConfig(): NextJSSessionConfig {
  return {
    apiBaseURL: API_BASE_URL,
    publishableKey: PUBLISHABLE_KEY,
    session: {
      cookieName: "app_session_v1",
    },
  };
}

export function getPublicConfig(): PublicConfig {
  return {
    baseURL: API_BASE_URL,
    publishableKey: PUBLISHABLE_KEY,
  };
}
