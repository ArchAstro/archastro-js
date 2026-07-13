/**
 * URL helpers that avoid Hermes / older RN `URL` edge cases
 * (protocol mutation, `ws:` parsing).
 */

/**
 * Convert an HTTP(S) platform origin to the Phoenix ApiSocket WebSocket URL.
 * `http(s)://host[:port]/...` → `ws(s)://host[:port]/socket/api/websocket`
 */
export function platformSocketUrl(apiBaseUrl: string): string {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const withScheme = base.includes("://") ? base : `http://${base}`;
  const match = withScheme.match(/^(https?):\/\/([^/?#]+)(?:[/?#].*)?$/i);
  if (!match) {
    throw new Error(`Invalid API base URL: ${apiBaseUrl}`);
  }
  const scheme = match[1].toLowerCase() === "https" ? "wss" : "ws";
  const host = match[2];
  return `${scheme}://${host}/socket/api/websocket`;
}

/**
 * Append query params to a URL string without relying on `URL` mutation.
 * Safe for `ws://` / `wss://` on React Native.
 */
export function appendQueryParams(
  url: string,
  params: Record<string, string>,
): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    pairs.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    );
  }
  if (pairs.length === 0) return url;
  const qs = pairs.join("&");
  return url.includes("?") ? `${url}&${qs}` : `${url}?${qs}`;
}
