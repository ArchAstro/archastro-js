// Copyright (c) 2026 ArchAstro Inc. All Rights Reserved.
// Mixed surface: generated re-exports + hand-maintained session/RN helpers.
// After OpenAPI regen, restore the hand-maintained block below if wiped.

export * from "./types/index.js";
export { V1 } from "./v1.js";
export * from "./v1/resources/index.js";
// Hand-maintained: PlatformClient.forApp (session storage + passwordless)
export {
  PlatformClient,
  type PlatformClientConfig,
} from "./platform-client.js";
// Generated client type alias available as InstanceType when needed
export type { PlatformClient as PlatformClientInstance } from "./client.js";
export { AuthClient, type AuthTokens } from "./auth.js";
export { ApiError, HttpClient, type HttpClientConfig } from "./runtime/http-client.js";
export { ApiActivityFeedChannel } from "./channels/api_activity_feed_channel.js";
export { ApiChatChannel } from "./channels/api_chat_channel.js";
export { ApiObjectChannel } from "./channels/api_object_channel.js";

// Hand-maintained (re-add after OpenAPI regen if this block is wiped):
export {
  PasswordlessAuth,
  type PasswordlessRegisterInput,
  type PasswordlessLoginCodeInput,
  type PasswordlessVerifyCodeInput,
} from "./passwordless.js";
export {
  forApp,
  type AppPlatformClient,
  type ForAppOptions,
  type SessionStorage,
  type StoredSession,
} from "./user-session.js";
export {
  platformSocketUrl,
  platformSocketUrl as buildPlatformSocketUrl,
  appendQueryParams,
} from "./runtime/url.js";
export {
  createPlatformSocket,
  type PlatformSocketOptions,
} from "./platform-socket.js";
export { Socket, type SocketConfig, type SocketEvent } from "./phx_channel/socket.js";
export { Channel, ChannelError } from "./phx_channel/channel.js";
