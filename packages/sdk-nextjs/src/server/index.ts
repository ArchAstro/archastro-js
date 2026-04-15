export {
  createSessionManager,
  type NextJSSessionConfig,
  type NextJSSessionManager,
  type SessionTokens,
} from "./session-manager.js";

export {
  createAuthActions,
  type AuthActions,
  type AuthResult,
  type SessionRefreshResult,
} from "./auth-actions.js";

export {
  createFederatedAuth,
  getExternalBaseUrl,
  type FederatedProvider,
  type FederatedAuthConfig,
  type StartFederatedLoginOptions,
} from "./federated-auth.js";

export {
  getExternalBaseUrlFromRequest,
  getPathname,
  getSearchParams,
  type RequestWithHeaders,
  type NextRequestLike,
} from "./request-helpers.js";

export { resolveApiBaseUrl } from "./runtime-config.js";
