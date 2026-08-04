import { describe, expect, it } from "vitest";

import {
  Channel,
  ChannelError,
  ChannelReplyError,
} from "../src/phx_channel/channel.js";

class FakeSocket {
  readonly timeoutMs = 10_000;
  private ref = 0;
  readonly sends: Array<{
    event: string;
    ref: string | null;
  }> = [];

  makeRef(): string {
    this.ref += 1;
    return String(this.ref);
  }

  send(
    _joinRef: string | null,
    ref: string | null,
    _topic: string,
    event: string,
  ): void {
    this.sends.push({ event, ref });
  }

  removeChannel(): void {}
}

describe("Channel transport loss", () => {
  it("rejects an in-flight push immediately instead of waiting for its timeout", async () => {
    const socket = new FakeSocket();
    const channel = new Channel(socket as never, "api:object:cobj_diagram", {});
    const join = channel.join();
    const joinRef = socket.sends[0]?.ref ?? null;
    channel.onMessage(joinRef, joinRef, "phx_reply", {
      status: "ok",
      response: {},
    });
    await join;

    const update = channel.push("update_fields", {
      fields: { title: "Queued safely" },
    });
    channel.onSocketClose(new ChannelError("transport closed"));

    await expect(update).rejects.toThrow("transport closed");
    expect(channel.state).toBe("errored");
  });

  it("rejects a Phoenix error reply instead of acknowledging the mutation", async () => {
    const socket = new FakeSocket();
    const channel = new Channel(socket as never, "api:object:cobj_diagram", {});
    const join = channel.join();
    const joinRef = socket.sends[0]?.ref ?? null;
    channel.onMessage(joinRef, joinRef, "phx_reply", {
      status: "ok",
      response: {},
    });
    await join;

    const update = channel.push("update_fields", {
      fields: { title: "Rejected edit" },
    });
    const updateRef = socket.sends.at(-1)?.ref ?? null;
    channel.onMessage(joinRef, updateRef, "phx_reply", {
      status: "error",
      response: { reason: "forbidden" },
    });

    await expect(update).rejects.toBeInstanceOf(ChannelReplyError);
    await expect(update).rejects.toThrow("forbidden");
  });
});
