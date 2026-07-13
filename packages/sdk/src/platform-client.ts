/**
 * Public PlatformClient export (hand-maintained).
 *
 * Re-exports the generated class and attaches durable-session factory
 * `forApp` without editing the OpenAPI-generated client body.
 */
import {
  PlatformClient as PlatformClientImpl,
  type PlatformClientConfig,
} from "./client.js";
import { forApp } from "./user-session.js";

export type { PlatformClientConfig };
/** Instance type of the generated PlatformClient. */
export type PlatformClient = PlatformClientImpl;

type PlatformClientStatic = typeof PlatformClientImpl & {
  /**
   * Client-side app with publishable key + durable session storage.
   * Prefer this for React Native / browser SPAs that need passwordless login
   * and automatic access-token refresh.
   */
  forApp: typeof forApp;
};

/**
 * Generated PlatformClient plus `forApp` session factory.
 * Other factories (`withSecretKey`, `withToken`, `withCredentials`) unchanged.
 */
export const PlatformClient: PlatformClientStatic = Object.assign(
  PlatformClientImpl,
  { forApp },
);
