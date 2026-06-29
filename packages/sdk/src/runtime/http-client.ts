// Runtime: HTTP client for the generated Platform SDK.
// This file is hand-maintained, not generated.

export const DEFAULT_API_PREFIX = "/api/v1";

export interface HttpClientConfig {
  baseUrl: string;
  accessToken?: string;
  getAccessToken?: () => string | undefined;
  onRefreshToken?: () => Promise<string>;
  pathPrefix?: string;
  defaultHeaders?: Record<string, string>;
  /** When true, only /api/v2/auth/* requests are allowed. Used by the
   *  internal refresh client to prevent accidental re-entrant calls. */
  refreshOnly?: boolean;
}

type QueryPrimitive = string | number | boolean;
type QueryValue = QueryPrimitive | QueryPrimitive[] | undefined;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorCode: string,
    message: string,
    public readonly body?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class HttpClient {
  private config: HttpClientConfig;
  private _refreshPromise: Promise<string> | null = null;

  constructor(config: HttpClientConfig) {
    this.config = config;
  }

  private getToken(): string | undefined {
    if (this.config.getAccessToken) {
      return this.config.getAccessToken();
    }
    return this.config.accessToken;
  }

  private transformPath(path: string): string {
    if (this.config.pathPrefix === undefined) return path;
    if (path.startsWith(DEFAULT_API_PREFIX)) {
      return this.config.pathPrefix + path.slice(DEFAULT_API_PREFIX.length);
    }
    return path;
  }

  setAccessToken(token: string) {
    this.config.accessToken = token;
  }

  setRefreshHandler(handler: () => Promise<string>) {
    this.config.onRefreshToken = handler;
  }

  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      query?: Record<string, QueryValue>;
    } = {}
  ): Promise<T> {
    const doFetch = (): Promise<Response> => {
      const { method = "GET", body, headers = {}, query } = options;
      const token = this.getToken();

      let url = `${this.config.baseUrl}${this.transformPath(path)}`;
      url = appendQueryString(url, query);

      const fetchOptions: RequestInit = {
        method,
        headers: {
          ...(this.config.defaultHeaders || {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
          ...headers,
        },
      };

      if (body && method !== "GET" && method !== "HEAD") {
        fetchOptions.body = JSON.stringify(body);
      }

      return fetch(url, fetchOptions);
    };

    if (this.config.refreshOnly && !path.startsWith(`${DEFAULT_API_PREFIX}/auth/`)) {
      throw new Error(
        `Refresh-only HTTP client cannot make requests outside ${DEFAULT_API_PREFIX}/auth/`
      );
    }

    let response = await doFetch();

    // Auto-refresh: on 401, attempt one token refresh and retry.
    // The refresh handler runs on a separate HttpClient (refreshOnly),
    // so it cannot re-enter this block. Concurrent 401s piggyback on
    // the same _refreshPromise.
    if (
      response.status === 401 &&
      this.config.onRefreshToken &&
      !path.startsWith(`${DEFAULT_API_PREFIX}/auth/`)
    ) {
      if (!this._refreshPromise) {
        this._refreshPromise = this.config.onRefreshToken().finally(() => {
          this._refreshPromise = null;
        });
      }
      let refreshed = false;
      try {
        const newToken = await this._refreshPromise;
        this.config.accessToken = newToken;
        refreshed = true;
      } catch {
        // refresh failed — fall through to throw original 401
      }
      if (refreshed) {
        response = await doFetch();
      }
    }

    if (!response.ok) {
      let rawData: Record<string, unknown> = {};
      try {
        rawData = (await response.json()) as Record<string, unknown>;
      } catch {
        // ignore parse errors
      }
      const { errorCode, message } = parseErrorResponse(rawData, response.status);
      throw new ApiError(response.status, errorCode, message, rawData);
    }

    if (response.status === 204) {
      return undefined as unknown as T;
    }

    return response.json() as Promise<T>;
  }

  async requestRaw(
    path: string,
    options: {
      headers?: Record<string, string>;
      query?: Record<string, QueryValue>;
    } = {}
  ): Promise<{ content: ArrayBuffer; mimeType: string }> {
    if (this.config.refreshOnly && !path.startsWith(`${DEFAULT_API_PREFIX}/auth/`)) {
      throw new Error(
        `Refresh-only HTTP client cannot make requests outside ${DEFAULT_API_PREFIX}/auth/`
      );
    }

    const doFetch = (): Promise<Response> => {
      const { headers = {}, query } = options;
      const token = this.getToken();

      let url = `${this.config.baseUrl}${this.transformPath(path)}`;
      url = appendQueryString(url, query);

      return fetch(url, {
        method: "GET",
        headers: {
          ...(this.config.defaultHeaders || {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
      });
    };

    let response = await doFetch();

    if (
      response.status === 401 &&
      this.config.onRefreshToken &&
      !path.startsWith(`${DEFAULT_API_PREFIX}/auth/`)
    ) {
      if (!this._refreshPromise) {
        this._refreshPromise = this.config.onRefreshToken().finally(() => {
          this._refreshPromise = null;
        });
      }
      let refreshed = false;
      try {
        const newToken = await this._refreshPromise;
        this.config.accessToken = newToken;
        refreshed = true;
      } catch {
        // refresh failed — fall through to throw original 401
      }
      if (refreshed) {
        response = await doFetch();
      }
    }

    if (!response.ok) {
      let rawData: Record<string, unknown> = {};
      try {
        rawData = (await response.json()) as Record<string, unknown>;
      } catch {
        // ignore parse errors
      }
      const { errorCode, message } = parseErrorResponse(rawData, response.status);
      throw new ApiError(response.status, errorCode, message, rawData);
    }

    const content = await response.arrayBuffer();
    const mimeType = response.headers.get("content-type") || "application/octet-stream";

    return { content, mimeType };
  }

  async requestStream(
    path: string,
    options: {
      headers?: Record<string, string>;
      query?: Record<string, QueryValue>;
      signal?: AbortSignal;
    } = {}
  ): Promise<ReadableStream<Uint8Array>> {
    if (this.config.refreshOnly && !path.startsWith(`${DEFAULT_API_PREFIX}/auth/`)) {
      throw new Error(
        `Refresh-only HTTP client cannot make requests outside ${DEFAULT_API_PREFIX}/auth/`
      );
    }

    const doFetch = (): Promise<Response> => {
      const { headers = {}, query, signal } = options;
      const token = this.getToken();

      let url = `${this.config.baseUrl}${this.transformPath(path)}`;
      url = appendQueryString(url, query);

      return fetch(url, {
        method: "GET",
        headers: {
          ...(this.config.defaultHeaders || {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          Accept: "text/event-stream",
          ...headers,
        },
        signal,
      });
    };

    let response = await doFetch();

    if (
      response.status === 401 &&
      this.config.onRefreshToken &&
      !path.startsWith(`${DEFAULT_API_PREFIX}/auth/`)
    ) {
      if (!this._refreshPromise) {
        this._refreshPromise = this.config.onRefreshToken().finally(() => {
          this._refreshPromise = null;
        });
      }
      let refreshed = false;
      try {
        const newToken = await this._refreshPromise;
        this.config.accessToken = newToken;
        refreshed = true;
      } catch {
        // refresh failed — fall through to throw original 401
      }
      if (refreshed) {
        response = await doFetch();
      }
    }

    if (!response.ok) {
      let rawData: Record<string, unknown> = {};
      try {
        rawData = (await response.json()) as Record<string, unknown>;
      } catch {
        // ignore
      }
      const { errorCode, message } = parseErrorResponse(rawData, response.status);
      throw new ApiError(response.status, errorCode, message, rawData);
    }

    if (!response.body) {
      throw new ApiError(500, "no_body", "Response has no body");
    }

    return response.body;
  }

  /**
   * Open a Server-Sent Events stream and yield parsed `{ event, data }`
   * records. Supports any method + JSON body (unlike `requestStream`, which is
   * GET-only), so it backs the generated `stream()` methods for
   * `x-sdk-streaming` endpoints. Honors auth + one-shot 401 refresh and throws
   * `ApiError` on a non-2xx response before the stream opens.
   */
  async *streamSSE(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      query?: Record<string, QueryValue>;
      signal?: AbortSignal;
    } = {}
  ): AsyncGenerator<{ event: string; data: unknown }, void, unknown> {
    if (this.config.refreshOnly && !path.startsWith(`${DEFAULT_API_PREFIX}/auth/`)) {
      throw new Error(
        `Refresh-only HTTP client cannot make requests outside ${DEFAULT_API_PREFIX}/auth/`
      );
    }

    const doFetch = (): Promise<Response> => {
      const { method = "GET", body, headers = {}, query, signal } = options;
      const token = this.getToken();
      const sendsBody = body !== undefined && method !== "GET" && method !== "HEAD";

      let url = `${this.config.baseUrl}${this.transformPath(path)}`;
      url = appendQueryString(url, query);

      const fetchOptions: RequestInit = {
        method,
        headers: {
          ...(this.config.defaultHeaders || {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          Accept: "text/event-stream",
          ...(sendsBody ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        signal,
      };
      if (sendsBody) {
        fetchOptions.body = JSON.stringify(body);
      }
      return fetch(url, fetchOptions);
    };

    let response = await doFetch();

    if (
      response.status === 401 &&
      this.config.onRefreshToken &&
      !path.startsWith(`${DEFAULT_API_PREFIX}/auth/`)
    ) {
      if (!this._refreshPromise) {
        this._refreshPromise = this.config.onRefreshToken().finally(() => {
          this._refreshPromise = null;
        });
      }
      let refreshed = false;
      try {
        const newToken = await this._refreshPromise;
        this.config.accessToken = newToken;
        refreshed = true;
      } catch {
        // refresh failed — fall through to throw original 401
      }
      if (refreshed) {
        response = await doFetch();
      }
    }

    if (!response.ok) {
      let rawData: Record<string, unknown> = {};
      try {
        rawData = (await response.json()) as Record<string, unknown>;
      } catch {
        // ignore parse errors
      }
      const { errorCode, message } = parseErrorResponse(rawData, response.status);
      throw new ApiError(response.status, errorCode, message, rawData);
    }

    if (!response.body) {
      throw new ApiError(500, "no_body", "SSE response has no body");
    }

    yield* parseEventStream(response.body);
  }
}

/** Parse a `text/event-stream` byte stream into `{ event, data }` records. */
async function* parseEventStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<{ event: string; data: unknown }, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev = parseSseBlock(block);
      if (ev) yield ev;
    }
    if (done) break;
  }
  const tail = parseSseBlock(buf);
  if (tail) yield tail;
}

function parseSseBlock(
  block: string
): { event: string; data: unknown } | null {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (event === undefined && dataLines.length === 0) return null;
  const raw = dataLines.join("\n");
  let data: unknown = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    // leave as the raw string
  }
  return { event: event ?? "message", data };
}

function parseErrorResponse(
  rawData: Record<string, unknown>,
  status: number
): { errorCode: string; message: string } {
  if (rawData.error && typeof rawData.error === "object") {
    const nested = rawData.error as {
      type?: string;
      code?: string;
      message?: string;
      fields?: { field: string; message: string }[];
    };
    let message = nested.message || `HTTP ${status}`;
    if (Array.isArray(nested.fields) && nested.fields.length > 0) {
      const fieldErrors = nested.fields
        .map((f) => `${f.field}: ${f.message}`)
        .join(", ");
      message = `${message} (${fieldErrors})`;
    }
    return {
      errorCode: nested.code || nested.type || "unknown_error",
      message,
    };
  }
  const errorStr =
    typeof rawData.error === "string" ? rawData.error : undefined;
  const message =
    typeof rawData.message === "string"
      ? rawData.message
      : errorStr || `HTTP ${status}`;
  return { errorCode: errorStr || "unknown_error", message };
}

function appendQueryString(
  url: string,
  query?: Record<string, QueryValue>
): string {
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(`${key}[]`, String(item));
      }
      continue;
    }
    params.set(key, String(value));
  }
  const qs = params.toString();
  if (!qs) return url;
  return `${url}?${qs}`;
}
