// src/ts/platform-sdk-nextjs/src/edge/index.ts
// Edge-compatible exports (no @archastro/sdk dependencies)
// Use this import path for middleware and edge functions

export {
  getExternalBaseUrlFromRequest,
  getPathname,
  getSearchParams,
  type RequestWithHeaders,
  type NextRequestLike,
} from "../server/request-helpers.js";
