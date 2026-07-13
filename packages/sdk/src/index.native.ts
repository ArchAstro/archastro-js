/**
 * React Native entry for `@archastro/sdk`.
 *
 * Metro resolves package.json `"react-native"` / exports.`react-native` here.
 * Same public surface as the Node/browser entry — sockets use global WebSocket
 * via `phx_channel/websocket.native.js` (never pulls Node `ws`).
 *
 * App-side you still provide:
 * - fetch (global in RN)
 * - SessionStorage (e.g. expo-secure-store)
 * - publishable key + baseUrl
 */
export * from "./index.js";
