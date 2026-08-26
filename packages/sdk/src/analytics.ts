import type { HttpClient } from "./runtime/http-client.js";

export const DEFAULT_ANONYMOUS_ID_COOKIE = "aa_anon_id";

const DEFAULT_COOKIE_MAX_AGE_DAYS = 365;

export interface AnalyticsClientOptions {
  anonymousIdCookieName?: string;
  cookieDomain?: string;
  cookieMaxAgeDays?: number;
  initialAnonymousId?: string;
  onAnonymousIdGenerated?: (anonymousId: string) => void;
  secureCookie?: boolean | "auto";
}

export interface AnalyticsTrackOptions {
  anonymousId?: string | null;
  userId?: string;
  properties?: Record<string, unknown>;
  timestamp?: Date | string;
  threadId?: string;
  keepalive?: boolean;
}

export interface AnalyticsEvent {
  event_id: string;
  event_name: string;
  timestamp: string;
  event_properties?: Record<string, unknown>;
  value?: string | number;
  thread?: string;
}

export interface TrackEventsOptions {
  anonymousId?: string | null;
  userId?: string;
  properties?: Record<string, unknown>;
  keepalive?: boolean;
}

export interface SafeBrowserAnalyticsPropertiesOptions {
  allowedSearchParams?: readonly string[];
  maxValueLength?: number;
  includeCurrentPath?: boolean;
  path?: string | null;
  redactPathSegments?: boolean;
  referrer?: string | null;
  search?: string | URLSearchParams | null;
}

const DEFAULT_BROWSER_ANALYTICS_SEARCH_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
] as const;

export class AnalyticsClient {
  private anonymousId: string | null = null;
  private readonly cookieName: string;
  private readonly cookieDomain?: string;
  private readonly cookieMaxAgeDays: number;
  private readonly onAnonymousIdGenerated?: (anonymousId: string) => void;
  private readonly secureCookie: boolean | "auto";

  constructor(
    private readonly http: HttpClient,
    options: AnalyticsClientOptions = {},
  ) {
    this.cookieName =
      options.anonymousIdCookieName ?? DEFAULT_ANONYMOUS_ID_COOKIE;
    this.cookieDomain = options.cookieDomain;
    this.cookieMaxAgeDays =
      options.cookieMaxAgeDays ?? DEFAULT_COOKIE_MAX_AGE_DAYS;
    this.onAnonymousIdGenerated = options.onAnonymousIdGenerated;
    this.secureCookie = options.secureCookie ?? "auto";
    this.anonymousId = options.initialAnonymousId ?? null;
  }

  getAnonymousId(): string {
    if (this.anonymousId) return this.anonymousId;

    const existing = this.readCookie();
    if (existing) {
      this.anonymousId = existing;
      this.writeCookie(existing);
      return existing;
    }

    const generated = this.generateAnonymousId();
    this.anonymousId = generated;
    this.writeCookie(generated);
    this.onAnonymousIdGenerated?.(generated);
    return generated;
  }

  async track(
    eventName: string,
    eventProperties: Record<string, unknown> = {},
    options: AnalyticsTrackOptions = {},
  ): Promise<void> {
    const anonymousId =
      options.anonymousId === undefined
        ? this.getAnonymousId()
        : options.anonymousId;
    const event: AnalyticsEvent = {
      event_id: this.generateEventId(),
      event_name: eventName,
      timestamp: this.resolveTimestamp(options.timestamp),
      event_properties: eventProperties,
    };
    if (options.threadId) event.thread = options.threadId;

    await this.trackEvents([event], {
      anonymousId,
      userId: options.userId,
      properties: options.properties,
      keepalive: options.keepalive,
    });
  }

  async trackEvents(
    events: AnalyticsEvent[],
    options: TrackEventsOptions = {},
  ): Promise<void> {
    const anonymousId =
      options.anonymousId === undefined
        ? this.getAnonymousId()
        : options.anonymousId;
    const body: Record<string, unknown> = { events };
    if (options.properties) body.properties = options.properties;
    if (options.userId) body.user = options.userId;
    if (anonymousId) body.anonymous = anonymousId;

    await this.http.request("/api/v1/t", {
      method: "POST",
      body,
      keepalive: options.keepalive,
    });
  }

  async linkIdentity(anonymousId: string, userId: string): Promise<boolean> {
    const response = await this.http.request<{ linked: boolean }>("/api/v1/i", {
      method: "POST",
      body: {
        anonymous: anonymousId,
        user: userId,
      },
    });
    return response.linked;
  }

  async linkCurrentIdentity(userId: string): Promise<boolean> {
    const anonymousId = this.getAnonymousId();
    return this.linkIdentity(anonymousId, userId);
  }

  private generateAnonymousId(): string {
    return this.generateId("anon");
  }

  private generateEventId(): string {
    return this.generateId("evt");
  }

  private generateId(prefix: string): string {
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.randomUUID === "function") {
      return cryptoApi.randomUUID();
    }
    const randomPart = Math.random().toString(36).slice(2);
    return `${prefix}_${Date.now()}_${randomPart}`;
  }

  private resolveTimestamp(timestamp?: Date | string): string {
    if (timestamp instanceof Date) return timestamp.toISOString();
    if (typeof timestamp === "string") return timestamp;
    return new Date().toISOString();
  }

  private readCookie(): string | null {
    if (typeof document === "undefined") return null;
    const prefix = `${this.cookieName}=`;
    const value = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix))
      ?.slice(prefix.length);
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }

  private writeCookie(value: string): void {
    if (typeof document === "undefined") return;
    const maxAge = Math.max(this.cookieMaxAgeDays, 1) * 24 * 60 * 60;
    const parts = [
      `${this.cookieName}=${encodeURIComponent(value)}`,
      "path=/",
      `max-age=${maxAge}`,
      "samesite=lax",
    ];
    const domain = this.cookieDomain ?? this.defaultCookieDomain();
    if (domain) parts.push(`domain=${domain}`);
    if (this.shouldSecureCookie()) parts.push("secure");
    document.cookie = parts.join("; ");
  }

  private defaultCookieDomain(): string | null {
    if (typeof window === "undefined" || !window.location?.hostname) {
      return null;
    }
    const hostname = window.location.hostname;
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      /^\d+\.\d+\.\d+\.\d+$/.test(hostname)
    ) {
      return null;
    }
    return `.${hostname}`;
  }

  private shouldSecureCookie(): boolean {
    if (this.secureCookie !== "auto") return this.secureCookie;
    return (
      typeof window !== "undefined" &&
      window.location?.protocol === "https:"
    );
  }
}

export function createAnalyticsClient(
  http: HttpClient,
  options?: AnalyticsClientOptions,
): AnalyticsClient {
  return new AnalyticsClient(http, options);
}

export function safeBrowserAnalyticsProperties(
  options: SafeBrowserAnalyticsPropertiesOptions = {},
): Record<string, string> {
  const properties: Record<string, string> = {};
  const maxLength = Math.max(options.maxValueLength ?? 80, 1);
  const path =
    options.path === undefined
      ? options.includeCurrentPath
        ? currentPathname()
        : null
      : options.path;
  const safePath = path
    ? safeAnalyticsPath(path, options.redactPathSegments ?? true)
    : null;

  if (safePath) properties.path = truncateAnalyticsValue(safePath, maxLength);

  const referrer =
    options.referrer === undefined ? currentReferrer() : options.referrer;
  const referrerHost = referrer ? parseHostname(referrer) : null;
  if (referrerHost) {
    properties.referrer = truncateAnalyticsValue(referrerHost, maxLength);
  }

  const search = options.search === undefined ? currentSearch() : options.search;
  const searchParams =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const allowedSearchParams =
    options.allowedSearchParams ?? DEFAULT_BROWSER_ANALYTICS_SEARCH_PARAMS;

  for (const key of allowedSearchParams) {
    const value = searchParams?.get(key);
    if (value) {
      properties[key] = truncateAnalyticsValue(value, maxLength);
    }
  }

  return properties;
}

type AnalyticsBase = new (...args: any[]) => { http: HttpClient };

export function withAnalytics(
  optionsOrFactory?:
    | AnalyticsClientOptions
    | ((client: { http: HttpClient }) => AnalyticsClientOptions),
): <TBase extends AnalyticsBase>(
  Base: TBase,
) => ReturnType<typeof addAnalytics<TBase>>;

export function withAnalytics(
  optionsOrFactory?:
    | AnalyticsClientOptions
    | ((client: { http: HttpClient }) => AnalyticsClientOptions),
) {
  return <TBase extends AnalyticsBase>(Base: TBase) =>
    addAnalytics(Base, optionsOrFactory);
}

function addAnalytics<TBase extends AnalyticsBase>(
  Base: TBase,
  optionsOrFactory?:
    | AnalyticsClientOptions
    | ((client: { http: HttpClient }) => AnalyticsClientOptions),
) {
  return class AnalyticsPlatformClient extends Base {
    readonly analytics: AnalyticsClient;

    constructor(...args: any[]) {
      super(...args);
      const options =
        typeof optionsOrFactory === "function"
          ? optionsOrFactory(this)
          : optionsOrFactory;
      this.analytics = new AnalyticsClient(this.http, options);
    }
  };
}

function currentPathname(): string | null {
  if (typeof window === "undefined") return null;
  return window.location?.pathname ?? null;
}

function currentReferrer(): string | null {
  if (typeof document === "undefined") return null;
  return document.referrer || null;
}

function currentSearch(): string | null {
  if (typeof window === "undefined") return null;
  return window.location?.search ?? null;
}

function stripQueryAndHash(value: string): string {
  return value.split(/[?#]/, 1)[0] ?? "";
}

function safeAnalyticsPath(value: string, redactSegments: boolean): string {
  const path = stripQueryAndHash(value);
  if (!redactSegments) return path;
  return path
    .split("/")
    .map((segment) =>
      shouldRedactPathSegment(segment) ? ":redacted" : segment,
    )
    .join("/");
}

function shouldRedactPathSegment(segment: string): boolean {
  if (!segment) return false;
  const decoded = safeDecodeURIComponent(segment);
  return (
    decoded.includes("@") ||
    decoded.length > 64 ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      decoded,
    ) ||
    /^[0-9a-f]{16,}$/i.test(decoded) ||
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.?[A-Za-z0-9_-]*$/.test(decoded) ||
    /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_-]{20,}$/.test(decoded)
  );
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseHostname(value: string): string | null {
  try {
    return new URL(value).hostname || null;
  } catch {
    return null;
  }
}

function truncateAnalyticsValue(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
