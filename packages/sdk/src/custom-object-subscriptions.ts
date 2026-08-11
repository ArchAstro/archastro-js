import type { z } from "zod";

import type {
  PlatformClient,
  PlatformClientClass,
  PlatformClientConfig,
} from "./client.js";
import { ApiObjectChannel } from "./channels/api_object_channel.js";
import {
  ApiError,
  AuthenticationError,
  AuthorizationError,
  NetworkError,
  NotFoundError,
  ValidationError,
} from "./runtime/http-client.js";
import type { HttpClient } from "./runtime/http-client.js";
import { createPlatformSocket } from "./platform-socket.js";
import { ChannelReplyError } from "./phx_channel/channel.js";
import type { Socket } from "./phx_channel/socket.js";

export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export type CustomObjectConnectionState =
  | "connecting"
  | "live"
  | "reconnecting"
  | "offline"
  | "unauthorized"
  | "closed";

export interface CustomObjectSnapshot<TFields> {
  id: string;
  fields: TFields;
  readonly?: boolean;
  connectionId?: string;
}

export interface CustomObjectUpdate<TFields> {
  id: string;
  fields: DeepPartial<TFields>;
}

export interface CustomObjectPresence {
  userId: string;
  connectionId: string;
  displayName: string;
  cursor?: { x: number; y: number } | null;
  selectedElementIds: string[];
  color: string;
  activity: "active" | "idle";
}

export interface CustomObjectPresenceUpdate {
  cursor?: { x: number; y: number } | null;
  selectedElementIds: string[];
  activity: "active" | "idle";
}

export interface CustomObjectPresenceLeave {
  connectionId: string;
}

export interface CustomObjectSubscriptionOptions<
  TFields extends object,
> {
  objectId: string;
  /** Stable identity for this browser tab. Generated when omitted. */
  connectionId?: string;
  /** Optional runtime validator for authoritative snapshots. */
  fieldsSchema?: z.ZodType<TFields>;
  onSnapshot(snapshot: CustomObjectSnapshot<TFields>): void;
  onUpdate(update: CustomObjectUpdate<TFields>): void;
  onPresence?(presence: CustomObjectPresence): void;
  onPresenceLeave?(presence: CustomObjectPresenceLeave): void;
  onStateChange(state: CustomObjectConnectionState): void;
  onError(error: ApiError): void;
  /** Maximum reconnect delay. Defaults to 10 seconds. */
  maxReconnectDelayMs?: number;
  /** Maximum number of pending offline update calls. Defaults to 100. */
  maxQueuedPatches?: number;
}

export interface CustomObjectSubscription<
  TFields extends object,
> {
  readonly state: CustomObjectConnectionState;
  update(fields: DeepPartial<TFields>): Promise<void>;
  updatePresence(presence: CustomObjectPresenceUpdate): Promise<void>;
  save(): Promise<void>;
  close(): void;
}

type SocketFactory = () => Socket;
type Unsubscribe = () => void;

export interface CustomObjectSubscriptionsClientConfig
  extends PlatformClientConfig {
  socketPath?: string;
}

export interface CustomObjectSubscriptionsExtensionOptions {
  /** Override the socket path derived from the client's pathPrefix. */
  socketPath?: string;
}

interface QueuedPatch<TFields> {
  fields: DeepPartial<TFields>;
  waiters: Array<{ resolve(): void; reject(error: unknown): void }>;
}

export class CustomObjectSubscriptions {
  constructor(private readonly createSocket: SocketFactory) {}

  subscribe<TFields extends object>(
    options: CustomObjectSubscriptionOptions<TFields>,
  ): CustomObjectSubscription<TFields> {
    return new ManagedCustomObjectSubscription(this.createSocket, options);
  }
}

export type CustomObjectSubscriptionsPlatformClient<
  TClient extends PlatformClient = PlatformClient,
> = TClient & {
  readonly customObjectSubscriptions: CustomObjectSubscriptions;
};

type CustomObjectSubscriptionsCapability = {
  readonly customObjectSubscriptions: CustomObjectSubscriptions;
};

/** Add managed custom-object realtime to any generated PlatformClient class. */
export function withCustomObjectSubscriptions<
  TBase extends PlatformClientClass,
>(Base: TBase) {
  return extendWithCustomObjectSubscriptions(Base, {});
}

/** Configure managed custom-object realtime before extending a client class. */
export function customObjectSubscriptionsExtension(
  options: CustomObjectSubscriptionsExtensionOptions,
) {
  return <TBase extends PlatformClientClass>(Base: TBase) =>
    extendWithCustomObjectSubscriptions(Base, options);
}

function extendWithCustomObjectSubscriptions<
  TBase extends PlatformClientClass,
>(
  Base: TBase,
  options: CustomObjectSubscriptionsExtensionOptions,
): PlatformClientClass<
  InstanceType<TBase> & CustomObjectSubscriptionsCapability
> {
  class CustomObjectSubscriptionsPlatformClient extends Base {
    readonly customObjectSubscriptions: CustomObjectSubscriptions;

    constructor(...args: any[]) {
      super(...args);
      const config = (args[0] ?? {}) as PlatformClientConfig;
      this.customObjectSubscriptions = customObjectSubscriptionsForClient(
        { ...config, socketPath: options.socketPath },
        this.http,
      );
    }
  }

  return CustomObjectSubscriptionsPlatformClient as unknown as PlatformClientClass<
    InstanceType<TBase> & CustomObjectSubscriptionsCapability
  >;
}

/** Build the managed realtime capability from generated client state. */
export function customObjectSubscriptionsForClient(
  config: CustomObjectSubscriptionsClientConfig,
  http: HttpClient,
): CustomObjectSubscriptions {
  const publishableKey = Object.entries(config.defaultHeaders ?? {}).find(
    ([name]) => name.toLowerCase() === "x-archastro-api-key",
  )?.[1];

  return new CustomObjectSubscriptions(() =>
    createPlatformSocket({
      apiBaseUrl: config.baseUrl ?? "https://platform.archastro.ai",
      accessToken: http.getAccessToken(),
      publishableKey,
      socketPath:
        config.socketPath ??
        (config.pathPrefix
          ? `${config.pathPrefix.replace(/\/+$/, "")}/socket`
          : undefined),
      socketConfig: { autoReconnect: false },
    }),
  );
}

export {
  ApiError,
  AuthenticationError,
  AuthorizationError,
  NetworkError,
  NotFoundError,
  ValidationError,
} from "./runtime/http-client.js";
export {
  Channel,
  ChannelError,
  ChannelReplyError,
  Socket,
  createPlatformSocket,
  type PlatformSocketOptions,
  type SocketConfig,
  type SocketEvent,
} from "./platform-socket.js";

class ManagedCustomObjectSubscription<
  TFields extends object,
> implements CustomObjectSubscription<TFields> {
  private _state: CustomObjectConnectionState = "connecting";
  private socket: Socket | null = null;
  private channel: ApiObjectChannel | null = null;
  private transportUnsubscribers: Unsubscribe[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private generation = 0;
  private queued: QueuedPatch<TFields>[] = [];
  private connecting = false;
  private connectionId: string;
  private lastPresence: CustomObjectPresenceUpdate | null = null;
  private presenceHeartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly createSocket: SocketFactory,
    private readonly options: CustomObjectSubscriptionOptions<TFields>,
  ) {
    this.connectionId = options.connectionId ?? generateConnectionId();
    queueMicrotask(() => {
      if (this._state === "closed") return;
      this.options.onStateChange("connecting");
      void this.connect(false);
    });
  }

  get state(): CustomObjectConnectionState {
    return this._state;
  }

  async update(fields: DeepPartial<TFields>): Promise<void> {
    if (this.isTerminal()) {
      throw new NetworkError(
        `Cannot update a ${this._state} custom-object subscription`,
      );
    }

    if (this._state !== "live" || !this.channel) {
      return this.enqueue(fields);
    }

    try {
      await this.channel.updateFields({ fields });
    } catch (error) {
      const classified = classifySubscriptionError(error);
      if (this.isTerminalError(classified)) {
        this.options.onError(classified);
        this.terminateForError(classified);
        throw classified;
      }
      if (!(classified instanceof NetworkError)) {
        this.options.onError(classified);
        throw classified;
      }
      const pending = this.enqueue(fields);
      this.handleTransportLoss(classified);
      return pending;
    }
  }

  async updatePresence(presence: CustomObjectPresenceUpdate): Promise<void> {
    if (this._state !== "live" || !this.channel) {
      throw new NetworkError(
        "Presence is unavailable while the subscription is not live",
      );
    }
    try {
      this.lastPresence = presence;
      this.startPresenceHeartbeat();
      await sendPresenceUpdate(this.channel, presence);
    } catch (error) {
      const classified = classifySubscriptionError(error);
      if (this.isTerminalError(classified)) {
        this.options.onError(classified);
        this.terminateForError(classified);
      } else if (classified instanceof NetworkError) {
        this.handleTransportLoss(classified);
      } else {
        this.options.onError(classified);
      }
      throw classified;
    }
  }

  async save(): Promise<void> {
    if (this._state !== "live" || !this.channel) {
      throw new NetworkError("Cannot save while the subscription is not live");
    }
    try {
      await this.channel.save({});
    } catch (error) {
      const classified = classifySubscriptionError(error);
      if (this.isTerminalError(classified)) {
        this.options.onError(classified);
        this.terminateForError(classified);
      } else if (classified instanceof NetworkError) {
        this.handleTransportLoss(classified);
      } else {
        this.options.onError(classified);
      }
      throw classified;
    }
  }

  close(): void {
    if (this._state === "closed") return;
    this.generation++;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.transition("closed");
    const closedError = new NetworkError(
      "Custom-object subscription was closed",
    );
    for (const queued of this.queued.splice(0)) {
      for (const waiter of queued.waiters) waiter.reject(closedError);
    }
    this.disposeTransport(true);
  }

  private async connect(reconnecting: boolean): Promise<void> {
    if (this.connecting || this.isTerminal()) return;
    this.connecting = true;
    const generation = ++this.generation;
    if (reconnecting) this.transition("reconnecting");

    try {
      const socket = this.createSocket();
      this.socket = socket;
      this.transportUnsubscribers.push(
        socket.onEvent((event) => {
          if (event.type === "close" || event.type === "error") {
            this.handleTransportLoss(
              event.type === "error"
                ? event.error
                : new NetworkError(`WebSocket closed with code ${event.code}`),
            );
          }
        }),
      );
      await socket.connect();
      if (generation !== this.generation || this.isTerminal()) {
        await socket.disconnect();
        return;
      }

      const channel = await ApiObjectChannel.joinById(
        socket,
        this.options.objectId,
        {
          partial_updates: true,
          connection_id: this.connectionId,
        },
      );
      if (generation !== this.generation || this.isTerminal()) {
        await channel.leave();
        await socket.disconnect();
        return;
      }
      this.channel = channel;
      this.installChannelListeners(channel);

      // Every join, including a rejoin, returns the authoritative snapshot.
      // Deliver it before replaying idempotent queued map assignments.
      const { snapshot, initialPresence } = this.parseSnapshot(
        channel.joinResponse,
      );
      if (snapshot.connectionId) this.connectionId = snapshot.connectionId;
      this.options.onSnapshot(snapshot);
      for (const presence of initialPresence)
        this.options.onPresence?.(presence);
      await this.replayQueuedPatches();
      if (generation !== this.generation || this.isTerminal()) return;
      this.reconnectAttempt = 0;
      this.transition("live");
      if (this.lastPresence) {
        await sendPresenceUpdate(channel, this.lastPresence);
        this.startPresenceHeartbeat();
      }
    } catch (error) {
      const classified = classifySubscriptionError(error);
      this.options.onError(classified);
      if (
        classified instanceof AuthenticationError ||
        classified instanceof AuthorizationError
      ) {
        this.terminateForError(classified);
      } else if (classified instanceof NotFoundError) {
        this.terminateForError(classified);
      } else {
        this.scheduleReconnect();
      }
    } finally {
      this.connecting = false;
    }
  }

  private installChannelListeners(channel: ApiObjectChannel): void {
    this.transportUnsubscribers.push(
      channel.onObjectUpdated((payload) => {
        const update = this.parseUpdate(payload);
        if (update) this.options.onUpdate(update);
      }),
      channel.onObjectDeleted(() => {
        const error = new NotFoundError(
          404,
          "custom_object_deleted",
          "The custom object was deleted",
        );
        this.options.onError(error);
        this.terminateForError(error);
      }),
      channel.onAccessRevoked(() => {
        const error = new AuthorizationError(
          403,
          "custom_object_access_revoked",
          "Access to the custom object was revoked",
        );
        this.options.onError(error);
        this.terminateForError(error);
      }),
      channel.onPresenceUpdated((payload) => {
        const presence = parsePresence(
          isRecord(payload) && "presence" in payload
            ? payload.presence
            : payload,
        );
        if (presence) this.options.onPresence?.(presence);
        else this.reportMalformed("Malformed presence_updated payload");
      }),
      channel.onPresenceLeft((payload) => {
        const presence = parsePresenceLeave(payload);
        if (presence) this.options.onPresenceLeave?.(presence);
        else this.reportMalformed("Malformed presence_left payload");
      }),
    );
  }

  private parseSnapshot(payload: unknown): {
    snapshot: CustomObjectSnapshot<TFields>;
    initialPresence: CustomObjectPresence[];
  } {
    const value = parseObjectEnvelope(payload);
    if (!value) {
      throw new ValidationError(
        422,
        "malformed_snapshot",
        "Custom-object join returned a malformed snapshot",
      );
    }
    const parsed = this.options.fieldsSchema?.safeParse(value.fields);
    if (parsed && !parsed.success) {
      throw new ValidationError(
        422,
        "malformed_snapshot",
        `Custom-object snapshot fields are invalid: ${parsed.error.message}`,
      );
    }
    const raw = payload as Record<string, unknown>;
    const readonly =
      typeof raw.readonly === "boolean" ? raw.readonly : undefined;
    const connectionId =
      stringField(raw, "connection_id", "connectionId") ?? undefined;
    const initialPresence: CustomObjectPresence[] = [];
    if (Array.isArray(raw.presence)) {
      for (const item of raw.presence) {
        const presence = parsePresence(item);
        if (presence) initialPresence.push(presence);
        else this.reportMalformed("Malformed initial presence payload");
      }
    }
    return {
      snapshot: {
        id: value.id,
        fields: (parsed?.success ? parsed.data : value.fields) as TFields,
        ...(readonly === undefined ? {} : { readonly }),
        ...(connectionId === undefined ? {} : { connectionId }),
      },
      initialPresence,
    };
  }

  private parseUpdate(payload: unknown): CustomObjectUpdate<TFields> | null {
    const value = parseObjectEnvelope(payload);
    if (!value) {
      this.reportMalformed("Malformed object_updated payload");
      return null;
    }
    return {
      id: value.id,
      fields: value.fields as DeepPartial<TFields>,
    };
  }

  private reportMalformed(message: string): void {
    this.options.onError(
      new ValidationError(422, "malformed_realtime_payload", message),
    );
  }

  private enqueue(fields: DeepPartial<TFields>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const pendingUpdates = this.queued.reduce(
        (count, patch) => count + patch.waiters.length,
        0,
      );
      if (pendingUpdates >= (this.options.maxQueuedPatches ?? 100)) {
        reject(
          new ValidationError(
            422,
            "offline_queue_full",
            "The custom-object offline queue is full",
          ),
        );
        return;
      }
      const last = this.queued.at(-1);
      if (last) {
        last.fields = deepMerge(last.fields, fields);
        last.waiters.push({ resolve, reject });
        return;
      }
      this.queued.push({ fields, waiters: [{ resolve, reject }] });
    });
  }

  private async replayQueuedPatches(): Promise<void> {
    while (this.queued.length > 0 && this.channel) {
      // Remove the batch before crossing the transport boundary. Updates that
      // arrive while its acknowledgement is pending must form a new batch;
      // mutating the in-flight object would drop those changes after the reply.
      const patch = this.queued.shift()!;
      try {
        await this.channel.updateFields({ fields: patch.fields });
      } catch (error) {
        this.queued.unshift(patch);
        throw error;
      }
      for (const waiter of patch.waiters) waiter.resolve();
    }
  }

  private handleTransportLoss(error: unknown): void {
    if (this.isTerminal()) return;
    const classified = classifySubscriptionError(error);
    this.options.onError(classified);
    if (this.isTerminalError(classified)) {
      this.terminateForError(classified);
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.isTerminal() || this.reconnectTimer) return;
    this.disposeTransport(false);
    const offline =
      typeof navigator !== "undefined" && navigator.onLine === false;
    this.transition(offline ? "offline" : "reconnecting");
    const base = Math.min(
      250 * 2 ** this.reconnectAttempt++,
      this.options.maxReconnectDelayMs ?? 10_000,
    );
    const jitter = Math.floor(Math.random() * Math.max(1, base * 0.2));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(true);
    }, base + jitter);
  }

  private disposeTransport(graceful: boolean): void {
    this.stopPresenceHeartbeat();
    for (const unsubscribe of this.transportUnsubscribers.splice(0))
      unsubscribe();
    const channel = this.channel;
    const socket = this.socket;
    this.channel = null;
    this.socket = null;
    if (graceful && channel) void channel.leave().catch(() => undefined);
    if (socket) void socket.disconnect().catch(() => undefined);
  }

  private transition(state: CustomObjectConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    this.options.onStateChange(state);
  }

  private isTerminal(): boolean {
    return this._state === "closed" || this._state === "unauthorized";
  }

  private isTerminalError(error: ApiError): boolean {
    return (
      error instanceof AuthenticationError ||
      error instanceof AuthorizationError ||
      error instanceof NotFoundError
    );
  }

  private terminateForError(error: ApiError): void {
    const state =
      error instanceof AuthenticationError ||
      error instanceof AuthorizationError
        ? "unauthorized"
        : "closed";
    this.transition(state);
    for (const queued of this.queued.splice(0)) {
      for (const waiter of queued.waiters) waiter.reject(error);
    }
    this.disposeTransport(false);
  }

  private startPresenceHeartbeat(): void {
    this.stopPresenceHeartbeat();
    if (!this.lastPresence || this._state !== "live") return;
    this.presenceHeartbeat = setInterval(() => {
      if (!this.channel || this._state !== "live" || !this.lastPresence) return;
      void sendPresenceUpdate(this.channel, this.lastPresence)
        .catch((error) => this.handleTransportLoss(error));
    }, 25_000);
  }

  private stopPresenceHeartbeat(): void {
    if (!this.presenceHeartbeat) return;
    clearInterval(this.presenceHeartbeat);
    this.presenceHeartbeat = null;
  }
}

function parseObjectEnvelope(
  payload: unknown,
): { id: string; fields: Record<string, unknown> } | null {
  if (
    !isRecord(payload) ||
    typeof payload.id !== "string" ||
    !isRecord(payload.fields)
  ) {
    return null;
  }
  return { id: payload.id, fields: payload.fields };
}

function toWirePresence(
  presence: CustomObjectPresenceUpdate,
): Record<string, unknown> {
  return {
    cursor: presence.cursor,
    selected_element_ids: presence.selectedElementIds,
    state: presence.activity,
  };
}

async function sendPresenceUpdate(
  channel: ApiObjectChannel,
  presence: CustomObjectPresenceUpdate,
): Promise<void> {
  try {
    await channel.presenceUpdate({ presence: toWirePresence(presence) });
  } catch (error) {
    if (isRateLimitedPresenceError(error)) return;
    throw error;
  }
}

function isRateLimitedPresenceError(error: unknown): boolean {
  if (
    !(error instanceof ChannelReplyError) ||
    error.event !== "presence_update"
  ) {
    return false;
  }

  if (error.response === "rate_limited") return true;
  if (!isRecord(error.response)) return false;
  const response = error.response;
  return ["reason", "code", "error"].some(
    (key) => response[key] === "rate_limited",
  );
}

function parsePresence(payload: unknown): CustomObjectPresence | null {
  if (!isRecord(payload)) return null;
  const userId = stringField(payload, "user_id", "userId");
  const connectionId = stringField(payload, "connection_id", "connectionId");
  const displayName = stringField(payload, "display_name", "displayName");
  const selected = payload.selected_element_ids ?? payload.selectedElementIds;
  if (
    !userId ||
    !connectionId ||
    !displayName ||
    !Array.isArray(selected) ||
    !selected.every((item) => typeof item === "string") ||
    (payload.state !== "active" &&
      payload.state !== "idle" &&
      payload.activity !== "active" &&
      payload.activity !== "idle")
  ) {
    return null;
  }
  const cursor = payload.cursor;
  if (
    cursor !== undefined &&
    cursor !== null &&
    (!isRecord(cursor) ||
      typeof cursor.x !== "number" ||
      typeof cursor.y !== "number")
  ) {
    return null;
  }
  return {
    userId,
    connectionId,
    displayName,
    cursor: cursor as { x: number; y: number } | null | undefined,
    selectedElementIds: selected,
    color:
      typeof payload.color === "string"
        ? payload.color
        : deterministicPresenceColor(userId),
    activity:
      payload.state === "active" || payload.state === "idle"
        ? payload.state
        : (payload.activity as "active" | "idle"),
  };
}

function parsePresenceLeave(
  payload: unknown,
): CustomObjectPresenceLeave | null {
  if (!isRecord(payload)) return null;
  const connectionId = stringField(payload, "connection_id", "connectionId");
  return connectionId ? { connectionId } : null;
}

function stringField(
  value: Record<string, unknown>,
  snake: string,
  camel: string,
): string | null {
  const field = value[snake] ?? value[camel];
  return typeof field === "string" ? field : null;
}

function classifySubscriptionError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("unauthorized") || normalized.includes("401")) {
    return new AuthenticationError(401, "unauthorized", message);
  }
  if (normalized.includes("forbidden") || normalized.includes("403")) {
    return new AuthorizationError(403, "forbidden", message);
  }
  if (normalized.includes("not_found") || normalized.includes("not found")) {
    return new NotFoundError(404, "not_found", message);
  }
  if (
    normalized.includes("unprocessable") ||
    normalized.includes("validation") ||
    normalized.includes("422")
  ) {
    return new ValidationError(422, "validation_error", message);
  }
  return new NetworkError(message, error);
}

function deepMerge<T>(left: T, right: T): T {
  if (!isRecord(left) || !isRecord(right)) return right;
  const merged: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    merged[key] =
      isRecord(merged[key]) && isRecord(value)
        ? deepMerge(merged[key], value)
        : value;
  }
  return merged as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function generateConnectionId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `connection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function deterministicPresenceColor(identity: string): string {
  const palette = [
    "#89b4fa",
    "#a6e3a1",
    "#f9e2af",
    "#f38ba8",
    "#cba6f7",
    "#94e2d5",
    "#fab387",
  ];
  let hash = 0;
  for (let index = 0; index < identity.length; index++) {
    hash = (hash * 31 + identity.charCodeAt(index)) >>> 0;
  }
  return palette[hash % palette.length]!;
}
