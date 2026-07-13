/**
 * WebSocket factory — Node + browser default.
 * React Native uses `websocket.native.ts` (Metro platform resolve) so the
 * Node-only `ws` package is never pulled into the RN bundle.
 */

export type WebSocketLike = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  readyState: number;
};

type WebSocketCtor = new (url: string) => WebSocketLike;

let wsCtorPromise: Promise<WebSocketCtor> | null = null;

function loadWsCtor(): Promise<WebSocketCtor> {
  if (!wsCtorPromise) {
    // Dynamic import via Function so bundlers that don't tree-shake
    // `import("ws")` don't statically require Node's `ws` package.
    const dynamicImport = new Function("s", "return import(s)") as (
      s: string,
    ) => Promise<{ default: WebSocketCtor }>;
    wsCtorPromise = dynamicImport("ws").then((m) => m.default);
  }
  return wsCtorPromise;
}

/**
 * Create a WebSocket for the given URL.
 * Prefers `globalThis.WebSocket` (browsers, React Native, modern Node).
 * Falls back to the optional `ws` package only when no global exists.
 */
export async function createWebSocket(url: string): Promise<WebSocketLike> {
  if (typeof globalThis.WebSocket !== "undefined") {
    return new globalThis.WebSocket(url) as unknown as WebSocketLike;
  }
  const WSCtor = await loadWsCtor();
  return new WSCtor(url);
}
