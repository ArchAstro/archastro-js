/**
 * Platform Phoenix socket factory (hand-maintained).
 * React Native / browsers use global WebSocket (`websocket.native.ts`);
 * Node falls back to optional `ws` via `websocket.ts`.
 */
import { Socket, type SocketConfig } from "./phx_channel/socket.js";
import { platformSocketUrl } from "./runtime/url.js";

export interface PlatformSocketOptions {
  apiBaseUrl: string;
  accessToken: string;
  /** Publishable key (pk_...) — optional for user JWT paths that only need token */
  publishableKey?: string;
  socketConfig?: Omit<SocketConfig, "params">;
}

/**
 * Open a Socket to the platform ApiSocket with token (+ optional api_key) params.
 */
export function createPlatformSocket(options: PlatformSocketOptions): Socket {
  const params: Record<string, string> = {
    token: options.accessToken,
  };
  if (options.publishableKey) {
    params.api_key = options.publishableKey;
  }
  return new Socket(platformSocketUrl(options.apiBaseUrl), {
    ...options.socketConfig,
    params,
  });
}

export { Socket, type SocketConfig, type SocketEvent } from "./phx_channel/socket.js";
export { Channel, ChannelError } from "./phx_channel/channel.js";
