import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthenticationError,
  AuthorizationError,
  CustomObjectSubscriptions,
  NotFoundError,
  PlatformClient,
  ValidationError,
  type CustomObjectConnectionState,
  type CustomObjectPresence,
} from "../src/index.js";
import type { SocketEvent } from "../src/phx_channel/socket.js";

interface DiagramFields {
  title: string;
  elements_by_id: Record<string, Record<string, unknown>>;
}

class FakeChannel {
  readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
  readonly pushes: Array<{ event: string; payload: unknown }> = [];
  leaveCount = 0;
  readonly joinPayloads: Record<string, unknown>[] = [];
  pushGate: Promise<void> | null = null;

  constructor(
    private readonly snapshot: unknown,
    private readonly joinError?: Error,
  ) {}

  async join(
    payload: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    this.joinPayloads.push(payload);
    if (this.joinError) throw this.joinError;
    return this.snapshot as Record<string, unknown>;
  }

  async leave(): Promise<void> {
    this.leaveCount++;
  }

  async push(event: string, payload: unknown): Promise<unknown> {
    this.pushes.push({ event, payload });
    await this.pushGate;
    return { status: "ok" };
  }

  on(event: string, callback: (payload: unknown) => void): () => void {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(callback);
    this.handlers.set(event, handlers);
    return () => handlers.delete(callback);
  }

  emit(event: string, payload: unknown): void {
    for (const callback of this.handlers.get(event) ?? []) callback(payload);
  }
}

class FakeSocket {
  readonly channelInstance: FakeChannel;
  disconnectCount = 0;
  private listeners = new Set<(event: SocketEvent) => void>();

  constructor(snapshot: unknown, joinError?: Error) {
    this.channelInstance = new FakeChannel(snapshot, joinError);
  }

  onEvent(listener: (event: SocketEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {
    this.disconnectCount++;
  }

  channel(): FakeChannel {
    return this.channelInstance;
  }

  emit(event: SocketEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function validSnapshot(title: string): unknown {
  return {
    id: "cobj_diagram",
    fields: { title, elements_by_id: {} },
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("CustomObjectSubscriptions", () => {
  it("remains available from the generated PlatformClient public surface", () => {
    const client = new PlatformClient({
      baseUrl: "https://archcode.test",
      pathPrefix: "/api/archastro/platform",
      credentials: "include",
      socketPath: "/api/archastro/platform/socket",
    });

    expect(client.customObjectSubscriptions).toBeInstanceOf(
      CustomObjectSubscriptions,
    );
  });

  it("bounds pending offline update calls even when their fields compact", async () => {
    const socket = new FakeSocket(validSnapshot("System map"));
    const subscription = new CustomObjectSubscriptions(
      () => socket as never,
    ).subscribe<DiagramFields>({
      objectId: "cobj_diagram",
      maxQueuedPatches: 1,
      onSnapshot: () => {},
      onUpdate: () => {},
      onStateChange: () => {},
      onError: () => {},
    });

    const first = subscription.update({ title: "Queued" });
    const overflow = subscription.update({
      elements_by_id: { service: { x: 1 } },
    });
    subscription.close();

    await expect(overflow).rejects.toMatchObject({
      errorCode: "offline_queue_full",
    });
    await expect(first).rejects.toMatchObject({ errorCode: "network_error" });
  });

  it("delivers the authenticated join snapshot and typed remote events", async () => {
    const socket = new FakeSocket(validSnapshot("System map"));
    const snapshots: unknown[] = [];
    const updates: unknown[] = [];
    const presence: CustomObjectPresence[] = [];
    const states: CustomObjectConnectionState[] = [];

    const subscription = new CustomObjectSubscriptions(
      () => socket as never,
    ).subscribe<DiagramFields>({
      objectId: "cobj_diagram",
      onSnapshot: (value) => snapshots.push(value),
      onUpdate: (value) => updates.push(value),
      onPresence: (value) => presence.push(value),
      onStateChange: (value) => states.push(value),
      onError: () => {},
    });
    await settle();
    await vi.waitFor(() => expect(subscription.state).toBe("live"));

    socket.channelInstance.emit("object_updated", {
      id: "cobj_diagram",
      fields: { title: "Updated" },
    });
    socket.channelInstance.emit("presence_updated", {
      presence: {
        user_id: "usr_1",
        connection_id: "tab_1",
        display_name: "Ada",
        cursor: { x: 10, y: 20 },
        selected_element_ids: ["shape_1"],
        state: "active",
      },
    });

    expect(snapshots).toEqual([validSnapshot("System map")]);
    expect(updates).toEqual([
      {
        id: "cobj_diagram",
        fields: { title: "Updated" },
      },
    ]);
    expect(presence[0]?.connectionId).toBe("tab_1");
    expect(presence[0]?.color).toMatch(/^#/);
    expect(socket.channelInstance.joinPayloads).toEqual([
      expect.objectContaining({
        partial_updates: true,
        connection_id: expect.any(String),
      }),
    ]);
    expect(states).toEqual(["connecting", "live"]);
    subscription.close();
  });

  it("preserves readonly join state, emits initial presence, and accepts ID-only leaves", async () => {
    const socket = new FakeSocket({
      id: "cobj_diagram",
      fields: { title: "Readonly map", elements_by_id: {} },
      readonly: true,
      connection_id: "server-tab-id",
      presence: [
        {
          user_id: "usr_1",
          connection_id: "collaborator-tab",
          display_name: "Grace",
          cursor: null,
          selected_element_ids: [],
          state: "idle",
        },
      ],
    });
    const snapshots: unknown[] = [];
    const presence: CustomObjectPresence[] = [];
    const leaves: Array<{ connectionId: string }> = [];
    const subscription = new CustomObjectSubscriptions(
      () => socket as never,
    ).subscribe<DiagramFields>({
      objectId: "cobj_diagram",
      connectionId: "requested-tab-id",
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onUpdate: () => {},
      onPresence: (value) => presence.push(value),
      onPresenceLeave: (value) => leaves.push(value),
      onStateChange: () => {},
      onError: () => {},
    });
    await vi.waitFor(() => expect(subscription.state).toBe("live"));
    socket.channelInstance.emit("presence_left", {
      connection_id: "collaborator-tab",
    });

    expect(snapshots).toEqual([
      {
        id: "cobj_diagram",
        fields: { title: "Readonly map", elements_by_id: {} },
        readonly: true,
        connectionId: "server-tab-id",
      },
    ]);
    expect(presence).toHaveLength(1);
    expect(presence[0]).toMatchObject({
      connectionId: "collaborator-tab",
      displayName: "Grace",
      activity: "idle",
    });
    expect(leaves).toEqual([{ connectionId: "collaborator-tab" }]);
    subscription.close();
  });

  it.each([
    ["object_deleted", NotFoundError, "closed"],
    ["access_revoked", AuthorizationError, "unauthorized"],
  ] as const)(
    "treats %s as a terminal subscription event",
    async (event, ErrorType, expectedState) => {
      const socket = new FakeSocket(validSnapshot("System map"));
      const errors: unknown[] = [];
      const subscription = new CustomObjectSubscriptions(
        () => socket as never,
      ).subscribe<DiagramFields>({
        objectId: "cobj_diagram",
        onSnapshot: () => {},
        onUpdate: () => {},
        onStateChange: () => {},
        onError: (error) => errors.push(error),
      });
      await vi.waitFor(() => expect(subscription.state).toBe("live"));

      socket.channelInstance.emit(event, {
        id: "cobj_diagram",
        reason: "membership_revoked",
      });

      expect(subscription.state).toBe(expectedState);
      expect(errors.at(-1)).toBeInstanceOf(ErrorType);
      expect(socket.disconnectCount).toBe(1);
    },
  );

  it("recovers the authoritative snapshot before replaying compacted offline patches", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const first = new FakeSocket(validSnapshot("Initial"));
    const second = new FakeSocket(validSnapshot("Remote while offline"));
    const sockets = [first, second];
    const timeline: string[] = [];
    const states: CustomObjectConnectionState[] = [];

    const subscription = new CustomObjectSubscriptions(
      () => sockets.shift() as never,
    ).subscribe<DiagramFields>({
      objectId: "cobj_diagram",
      onSnapshot: (snapshot) =>
        timeline.push(`snapshot:${snapshot.fields.title}`),
      onUpdate: () => {},
      onStateChange: (state) => states.push(state),
      onError: () => {},
    });
    await settle();
    await vi.waitFor(() => expect(subscription.state).toBe("live"));

    first.emit({ type: "close", code: 1006, reason: "network" });
    const firstPatch = subscription.update({
      elements_by_id: { service: { x: 10 } },
    });
    const secondPatch = subscription.update({
      elements_by_id: { service: { y: 20 } },
    });

    await vi.advanceTimersByTimeAsync(250);
    await settle();
    await Promise.all([firstPatch, secondPatch]);

    expect(timeline).toEqual([
      "snapshot:Initial",
      "snapshot:Remote while offline",
    ]);
    expect(second.channelInstance.pushes).toContainEqual({
      event: "update_fields",
      payload: {
        fields: {
          elements_by_id: { service: { x: 10, y: 20 } },
        },
      },
    });
    expect(states.at(-1)).toBe("live");
    subscription.close();
  });

  it("does not lose an update queued while a replay acknowledgement is pending", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const first = new FakeSocket(validSnapshot("Initial"));
    const second = new FakeSocket(validSnapshot("Recovered"));
    let releaseReplay!: () => void;
    second.channelInstance.pushGate = new Promise<void>((resolve) => {
      releaseReplay = resolve;
    });
    const sockets = [first, second];
    const subscription = new CustomObjectSubscriptions(
      () => sockets.shift() as never,
    ).subscribe<DiagramFields>({
      objectId: "cobj_diagram",
      onSnapshot: () => {},
      onUpdate: () => {},
      onStateChange: () => {},
      onError: () => {},
    });
    await settle();
    await vi.waitFor(() => expect(subscription.state).toBe("live"));

    first.emit({ type: "close", code: 1006, reason: "network" });
    const firstUpdate = subscription.update({ title: "First offline edit" });
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() =>
      expect(second.channelInstance.pushes).toHaveLength(1),
    );

    const concurrentUpdate = subscription.update({
      elements_by_id: { service: { x: 42 } },
    });
    releaseReplay();
    await Promise.all([firstUpdate, concurrentUpdate]);

    expect(second.channelInstance.pushes).toEqual([
      {
        event: "update_fields",
        payload: { fields: { title: "First offline edit" } },
      },
      {
        event: "update_fields",
        payload: { fields: { elements_by_id: { service: { x: 42 } } } },
      },
    ]);
    subscription.close();
  });

  it("classifies unauthorized joins as terminal and does not reconnect", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({}, new Error("unauthorized"));
    const errors: unknown[] = [];
    const states: CustomObjectConnectionState[] = [];
    let factoryCalls = 0;

    const subscription = new CustomObjectSubscriptions(() => {
      factoryCalls++;
      return socket as never;
    }).subscribe<DiagramFields>({
      objectId: "cobj_diagram",
      onSnapshot: () => {},
      onUpdate: () => {},
      onStateChange: (state) => states.push(state),
      onError: (error) => errors.push(error),
    });
    await settle();
    await vi.runAllTimersAsync();

    expect(subscription.state).toBe("unauthorized");
    expect(errors.some((error) => error instanceof AuthenticationError)).toBe(
      true,
    );
    expect(states.at(-1)).toBe("unauthorized");
    expect(factoryCalls).toBe(1);
  });

  it("rejects malformed snapshots and reports malformed remote payloads", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket({ id: "cobj_diagram", fields: [] });
    const errors: unknown[] = [];

    const subscription = new CustomObjectSubscriptions(
      () => socket as never,
    ).subscribe<DiagramFields>({
      objectId: "cobj_diagram",
      onSnapshot: () => {},
      onUpdate: () => {},
      onStateChange: () => {},
      onError: (error) => errors.push(error),
    });
    await settle();

    expect(errors.some((error) => error instanceof ValidationError)).toBe(true);
    subscription.close();
  });

  it("explicit close removes listeners and suppresses reconnect", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket(validSnapshot("Initial"));
    let factoryCalls = 0;
    let updates = 0;

    const subscription = new CustomObjectSubscriptions(() => {
      factoryCalls++;
      return socket as never;
    }).subscribe<DiagramFields>({
      objectId: "cobj_diagram",
      onSnapshot: () => {},
      onUpdate: () => updates++,
      onStateChange: () => {},
      onError: () => {},
    });
    await settle();
    await vi.waitFor(() => expect(subscription.state).toBe("live"));

    subscription.close();
    socket.emit({ type: "close", code: 1006, reason: "late close" });
    socket.channelInstance.emit("object_updated", validSnapshot("Late update"));
    await vi.runAllTimersAsync();

    expect(subscription.state).toBe("closed");
    expect(factoryCalls).toBe(1);
    expect(updates).toBe(0);
    expect(socket.disconnectCount).toBe(1);
  });

  it("does not duplicate remote listeners across repeated reconnects", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const first = new FakeSocket(validSnapshot("One"));
    const second = new FakeSocket(validSnapshot("Two"));
    const third = new FakeSocket(validSnapshot("Three"));
    const sockets = [first, second, third];
    let updates = 0;
    const subscription = new CustomObjectSubscriptions(
      () => sockets.shift() as never,
    ).subscribe<DiagramFields>({
      objectId: "cobj_diagram",
      onSnapshot: () => {},
      onUpdate: () => updates++,
      onStateChange: () => {},
      onError: () => {},
    });
    await settle();
    await vi.waitFor(() => expect(subscription.state).toBe("live"));

    first.emit({ type: "close", code: 1006, reason: "first loss" });
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    second.emit({ type: "close", code: 1006, reason: "second loss" });
    await vi.advanceTimersByTimeAsync(250);
    await settle();

    first.channelInstance.emit("object_updated", validSnapshot("stale one"));
    second.channelInstance.emit("object_updated", validSnapshot("stale two"));
    third.channelInstance.emit("object_updated", validSnapshot("current"));

    expect(updates).toBe(1);
    subscription.close();
  });

  it("refreshes presence below the server TTL without leaking heartbeat timers", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const first = new FakeSocket(validSnapshot("One"));
    const second = new FakeSocket(validSnapshot("Two"));
    const sockets = [first, second];
    const subscription = new CustomObjectSubscriptions(
      () => sockets.shift() as never,
    ).subscribe<DiagramFields>({
      objectId: "cobj_diagram",
      connectionId: "tab-stable",
      onSnapshot: () => {},
      onUpdate: () => {},
      onStateChange: () => {},
      onError: () => {},
    });
    await settle();
    await vi.waitFor(() => expect(subscription.state).toBe("live"));
    await subscription.updatePresence({
      cursor: { x: 1, y: 2 },
      selectedElementIds: [],
      activity: "active",
    });

    first.emit({ type: "close", code: 1006, reason: "network" });
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    expect(second.channelInstance.joinPayloads[0]).toMatchObject({
      partial_updates: true,
      connection_id: "tab-stable",
    });
    expect(
      second.channelInstance.pushes.filter(
        ({ event }) => event === "presence_update",
      ),
    ).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(25_000);
    expect(
      first.channelInstance.pushes.filter(
        ({ event }) => event === "presence_update",
      ),
    ).toHaveLength(1);
    expect(
      second.channelInstance.pushes.filter(
        ({ event }) => event === "presence_update",
      ),
    ).toHaveLength(2);
    expect(second.channelInstance.pushes.at(-1)?.payload).toEqual({
      presence: {
        cursor: { x: 1, y: 2 },
        selected_element_ids: [],
        state: "active",
      },
    });

    subscription.close();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(
      second.channelInstance.pushes.filter(
        ({ event }) => event === "presence_update",
      ),
    ).toHaveLength(2);
  });
});
