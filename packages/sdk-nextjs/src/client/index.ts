export {
  SDKProvider,
  ClientProvider,
  useClient,
  useSocket,
  useCurrentUser,
  useRefreshSession,
  useLogout,
  type SDKProviderProps,
  type SDKClientConfig,
} from "./hooks.js";

export {
  RuntimeConfigProvider,
  getRuntimeConfig,
  resetRuntimeConfigForTests,
  setRuntimeConfigForTests,
  useRuntimeConfig,
} from "./runtime-config.js";

export type {
  RuntimeConfigPrimitive,
  RuntimeConfigRecord,
} from "./runtime-config.js";

// Re-export types from server for convenience
export type { SessionRefreshResult } from "../server/auth-actions.js";

// Utilities
export { parseServerTimestamp } from "./utils/index.js";
