// Hand-written end-to-end contract proof for managed custom-object realtime.

import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessServiceClient } from "@archastro/channel-harness";
import {
  AuthorizationError,
  CustomObjectSubscriptions,
  Socket,
  type CustomObjectConnectionState,
} from "../../../src/index.js";

interface DiagramFields {
  title: string;
  elements_by_id: Record<string, Record<string, unknown>>;
}

interface Rig {
  client: HarnessServiceClient;
  socket: Socket;
}

async function bootHarness(): Promise<Rig> {
  const wsUrl = process.env.ARCHASTRO_HARNESS_WS_URL;
  const controlUrl = process.env.ARCHASTRO_HARNESS_CONTROL_URL;
  if (!wsUrl || !controlUrl) {
    throw new Error(
      "Managed subscription contract tests require the channel harness URLs",
    );
  }
  const client = new HarnessServiceClient({ wsUrl, controlUrl });
  await client.reset();
  const socket = new Socket(wsUrl, { autoReconnect: false });
  return { client, socket };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CustomObjectSubscriptions real transport", () => {
  it("joins, materializes, updates, publishes presence, saves, and closes over WebSocket", async () => {
    // Arrange a separate harness process with contract-valid replies. The
    // HTTP control boundary records what crosses the real WebSocket transport.
    const rig = await bootHarness();
    await rig.client.registerScenario({
      topic: "api:object:cobj_diagram",
      onJoin: [
        {
          type: "reply",
          payload: {
            id: "cobj_diagram",
            fields: { title: "System map", elements_by_id: {} },
            readonly: false,
            connection_id: "tab_e2e",
            presence: [],
          },
        },
      ],
      onMessage: {
        update_fields: [{ type: "autoReply" }],
        presence_update: [{ type: "autoReply" }],
        save: [{ type: "autoReply" }],
      },
    });

    // Cross the SDK's public subscription boundary and wait for the
    // authoritative join snapshot before sending collaborative mutations.
    const snapshots: unknown[] = [];
    const states: CustomObjectConnectionState[] = [];
    const subscription = new CustomObjectSubscriptions(
      () => rig.socket,
    ).subscribe<DiagramFields>({
      objectId: "cobj_diagram",
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onUpdate: () => {},
      onStateChange: (state) => states.push(state),
      onError: (error) => {
        throw error;
      },
    });
    await vi.waitFor(() => expect(subscription.state).toBe("live"));

    await subscription.update({ title: "Updated map" });
    await subscription.updatePresence({
      cursor: { x: 12, y: 34 },
      selectedElementIds: ["service"],
      activity: "active",
    });
    await subscription.save();

    // Assert externally observable frames at the harness control boundary,
    // then verify explicit cleanup reaches the terminal SDK state.
    expect(snapshots).toEqual([
      {
        id: "cobj_diagram",
        fields: { title: "System map", elements_by_id: {} },
        readonly: false,
        connectionId: "tab_e2e",
      },
    ]);
    expect(states).toEqual(["connecting", "live"]);
    expect(
      await rig.client.observations("api:object:cobj_diagram", "update_fields"),
    ).toEqual([
      expect.objectContaining({
        params: { fields: { title: "Updated map" } },
      }),
    ]);
    expect(
      await rig.client.observations(
        "api:object:cobj_diagram",
        "presence_update",
      ),
    ).toEqual([
      expect.objectContaining({
        params: {
          presence: {
            cursor: { x: 12, y: 34 },
            selected_element_ids: ["service"],
            state: "active",
          },
        },
      }),
    ]);
    expect(
      await rig.client.observations("api:object:cobj_diagram", "save"),
    ).toHaveLength(1);

    subscription.close();
    expect(subscription.state).toBe("closed");
    rig.client.closeAllSockets();
  });

  it("rejects and preserves a failed edit when Phoenix returns an error reply", async () => {
    // Configure a real WebSocket peer that accepts the join but rejects the
    // durable mutation at the Phoenix reply boundary.
    const rig = await bootHarness();
    await rig.client.registerScenario({
      topic: "api:object:cobj_forbidden",
      onJoin: [
        {
          type: "reply",
          payload: {
            id: "cobj_forbidden",
            fields: { title: "Readonly map", elements_by_id: {} },
            readonly: true,
            connection_id: "tab_forbidden",
            presence: [],
          },
        },
      ],
      onMessage: {
        update_fields: [
          { type: "replyError", payload: { reason: "forbidden" } },
        ],
      },
    });

    const errors: unknown[] = [];
    const subscription = new CustomObjectSubscriptions(
      () => rig.socket,
    ).subscribe<DiagramFields>({
      objectId: "cobj_forbidden",
      onSnapshot: () => {},
      onUpdate: () => {},
      onStateChange: () => {},
      onError: (error) => errors.push(error),
    });
    await vi.waitFor(() => expect(subscription.state).toBe("live"));

    await expect(
      subscription.update({ title: "Unauthorized edit" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(subscription.state).toBe("unauthorized");
    expect(errors).toEqual([expect.any(AuthorizationError)]);

    rig.client.closeAllSockets();
  });
});
