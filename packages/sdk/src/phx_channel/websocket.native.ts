/**
 * React Native WebSocket factory.
 * Metro resolves this over `websocket.ts` on native platforms so the
 * Node `ws` package is never required in the RN bundle graph.
 */

export type WebSocketLike = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  readyState: number;
};

/**
 * Create a WebSocket using the React Native global implementation.
 */
export async function createWebSocket(url: string): Promise<WebSocketLike> {
  if (typeof globalThis.WebSocket === "undefined") {
    throw new Error(
      "React Native global WebSocket is unavailable. " +
        "Ensure you are running in a native runtime (not Node).",
    );
  }
  return new globalThis.WebSocket(url) as unknown as WebSocketLike;
}
