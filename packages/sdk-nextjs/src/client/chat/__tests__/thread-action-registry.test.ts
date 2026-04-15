import { describe, it, expect } from "vitest";
import type { ThreadAction } from "@archastro/sdk";
import {
  isPendingThreadAction,
  getPendingThreadActions,
  getThreadActionPresentation,
  resolveThreadActionHref,
  getDomainFromAction,
} from "../thread-action-registry.js";

function makeAction(overrides: Partial<ThreadAction> & { type: string; id: string }): ThreadAction {
  return {
    status: "active",
    ...overrides,
  } as ThreadAction;
}

describe("isPendingThreadAction", () => {
  it("returns true for active actions", () => {
    expect(isPendingThreadAction(makeAction({ id: "1", type: "send_email", status: "active" }))).toBe(true);
  });

  it("returns true when status is missing", () => {
    expect(isPendingThreadAction(makeAction({ id: "1", type: "send_email", status: undefined }))).toBe(true);
  });

  it("returns false for done actions", () => {
    expect(isPendingThreadAction(makeAction({ id: "1", type: "send_email", status: "done" }))).toBe(false);
  });

  it("returns false for completed actions", () => {
    expect(isPendingThreadAction(makeAction({ id: "1", type: "send_email", status: "completed" }))).toBe(false);
  });

  it("returns false for canceled actions", () => {
    expect(isPendingThreadAction(makeAction({ id: "1", type: "send_email", status: "canceled" }))).toBe(false);
  });
});

describe("getPendingThreadActions", () => {
  it("filters out non-pending actions", () => {
    const actions = [
      makeAction({ id: "1", type: "send_email", status: "active" }),
      makeAction({ id: "2", type: "connect_google", status: "done" }),
      makeAction({ id: "3", type: "add_credential", status: "active" }),
    ];
    const result = getPendingThreadActions(actions);
    expect(result.map((a) => a.id)).toEqual(["3", "1"]);
  });

  it("sorts by priority descending", () => {
    const actions = [
      makeAction({ id: "1", type: "send_email" }),       // priority 60
      makeAction({ id: "2", type: "connect_google" }),    // priority 100
      makeAction({ id: "3", type: "add_credential" }),    // priority 80
    ];
    const result = getPendingThreadActions(actions);
    expect(result.map((a) => a.type)).toEqual(["connect_google", "add_credential", "send_email"]);
  });

  it("breaks priority ties alphabetically by type", () => {
    const actions = [
      makeAction({ id: "1", type: "calendar_event" }),   // priority 60
      makeAction({ id: "2", type: "send_email" }),        // priority 60
    ];
    const result = getPendingThreadActions(actions);
    expect(result.map((a) => a.type)).toEqual(["calendar_event", "send_email"]);
  });

  it("returns empty array for empty input", () => {
    expect(getPendingThreadActions([])).toEqual([]);
  });
});

describe("getThreadActionPresentation", () => {
  it("returns known presentation for connect_google", () => {
    const p = getThreadActionPresentation(makeAction({ id: "1", type: "connect_google" }));
    expect(p.title).toBe("Connect Google");
    expect(p.cta).toBe("Connect");
    expect(p.priority).toBe(100);
  });

  it("returns known presentation for send_email", () => {
    const p = getThreadActionPresentation(makeAction({ id: "1", type: "send_email" }));
    expect(p.title).toBe("Send email");
    expect(p.cta).toBe("Review");
  });

  it("returns default presentation for unknown type", () => {
    const p = getThreadActionPresentation(makeAction({ id: "1", type: "some_unknown_type" }));
    expect(p.title).toBe("Action needed");
    expect(p.cta).toBe("Open");
    expect(p.priority).toBe(10);
  });
});

describe("resolveThreadActionHref", () => {
  const baseOptions = { threadId: "thr_123" };

  it("returns action.path when set", () => {
    const action = makeAction({ id: "1", type: "connect_google", path: "/custom/path" });
    expect(resolveThreadActionHref(action, baseOptions)).toBe("/custom/path");
  });

  it("builds connector URL for connect_google", () => {
    const action = makeAction({ id: "act_1", type: "connect_google" });
    const href = resolveThreadActionHref(action, baseOptions)!;
    expect(href).toContain("/connectors/google?");
    expect(href).toContain("thread_id=thr_123");
    expect(href).toContain("action_id=act_1");
  });

  it("builds connector URL for connect_github", () => {
    const action = makeAction({ id: "act_2", type: "connect_github" });
    expect(resolveThreadActionHref(action, baseOptions)).toContain("/connectors/github?");
  });

  it("builds connector URL for connect_slack", () => {
    const action = makeAction({ id: "act_3", type: "connect_slack" });
    expect(resolveThreadActionHref(action, baseOptions)).toContain("/connectors/slack?");
  });

  it("builds connector URL for connect_microsoft", () => {
    const action = makeAction({ id: "act_4", type: "connect_microsoft" });
    expect(resolveThreadActionHref(action, baseOptions)).toContain("/connectors/microsoft?");
  });

  it("builds connector URL for connect_x_twitter", () => {
    const action = makeAction({ id: "act_5", type: "connect_x_twitter" });
    expect(resolveThreadActionHref(action, baseOptions)).toContain("/connectors/x-twitter?");
  });

  it("builds account URL for add_credential with domain", () => {
    const action = makeAction({ id: "act_6", type: "add_credential", metadata: { domain: "example.com" } });
    const href = resolveThreadActionHref(action, baseOptions)!;
    expect(href).toContain("/account?");
    expect(href).toContain("add_domain=example.com");
  });

  it("builds account URL for update_credential with domain", () => {
    const action = makeAction({ id: "act_7", type: "update_credential", metadata: { domain: "Example.COM" } });
    const href = resolveThreadActionHref(action, baseOptions)!;
    expect(href).toContain("update_domain=example.com");
  });

  it("builds account URL for setup_account", () => {
    const action = makeAction({ id: "act_8", type: "setup_account" });
    const href = resolveThreadActionHref(action, baseOptions)!;
    expect(href).toContain("/account?");
  });

  it("builds thread URL for send_email", () => {
    const action = makeAction({ id: "act_9", type: "send_email" });
    const href = resolveThreadActionHref(action, baseOptions)!;
    expect(href).toContain("/thread/thr_123");
    expect(href).toContain("action=send_email");
  });

  it("builds thread URL for calendar_event", () => {
    const action = makeAction({ id: "act_10", type: "calendar_event" });
    const href = resolveThreadActionHref(action, baseOptions)!;
    expect(href).toContain("action=calendar_event");
  });

  it("builds thread URL for create_calendar", () => {
    const action = makeAction({ id: "act_11", type: "create_calendar" });
    expect(resolveThreadActionHref(action, baseOptions)).toContain("action=create_calendar");
  });

  it("returns null for unknown type", () => {
    const action = makeAction({ id: "act_12", type: "unknown_type" });
    expect(resolveThreadActionHref(action, baseOptions)).toBeNull();
  });

  it("includes team_id and return_to when provided", () => {
    const action = makeAction({ id: "act_13", type: "connect_google" });
    const href = resolveThreadActionHref(action, {
      threadId: "thr_123",
      teamId: "team_456",
      returnTo: "/chat",
    })!;
    expect(href).toContain("team_id=team_456");
    expect(href).toContain("return_to=%2Fchat");
  });
});

describe("getDomainFromAction", () => {
  it("extracts domain from metadata", () => {
    const action = makeAction({ id: "1", type: "add_credential", metadata: { domain: "example.com" } });
    expect(getDomainFromAction(action)).toBe("example.com");
  });

  it("normalizes domain to lowercase", () => {
    const action = makeAction({ id: "1", type: "add_credential", metadata: { domain: "Example.COM" } });
    expect(getDomainFromAction(action)).toBe("example.com");
  });

  it("returns null when domain is missing", () => {
    const action = makeAction({ id: "1", type: "add_credential", metadata: {} });
    expect(getDomainFromAction(action)).toBeNull();
  });

  it("returns null when domain is empty string", () => {
    const action = makeAction({ id: "1", type: "add_credential", metadata: { domain: "  " } });
    expect(getDomainFromAction(action)).toBeNull();
  });

  it("returns null when metadata is undefined", () => {
    const action = makeAction({ id: "1", type: "add_credential" });
    expect(getDomainFromAction(action)).toBeNull();
  });
});
