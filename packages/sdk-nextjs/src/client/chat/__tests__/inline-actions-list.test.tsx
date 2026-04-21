import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { ThreadAction } from "../types.js";
import { InlineActionsList } from "../inline-actions-list.js";

function createSendEmailAction(id: string, overrides: Partial<ThreadAction> = {}): ThreadAction {
  return {
    id,
    type: "send_email",
    status: "active",
    call_to_action: "Send email",
    metadata: {
      action: "compose",
      to: ["test@example.com"],
      subject: "Test Subject",
      body: "Test body",
      integration_id: "int_123",
    },
    native_template: {
      component: "EmailPreview",
      props: {},
    },
    ...overrides,
  } as ThreadAction;
}

function createConnectAction(id: string, type: string): ThreadAction {
  return {
    id,
    type,
    status: "active",
    call_to_action: `Connect ${type.replace("connect_", "")}`,
    metadata: {},
  } as ThreadAction;
}

describe("InlineActionsList", () => {
  it("renders nothing when no actions provided", () => {
    const { container } = render(
      <InlineActionsList
        actions={[]}
        threadId="thr_123"
        onRunAction={vi.fn()}
        onDismissAction={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when all actions are completed", () => {
    const actions = [
      createSendEmailAction("tha_1", { status: "done" }),
      createSendEmailAction("tha_2", { status: "completed" }),
    ];
    const { container } = render(
      <InlineActionsList
        actions={actions}
        threadId="thr_123"
        onRunAction={vi.fn()}
        onDismissAction={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("filters to only actions with native_template", () => {
    const actions = [
      createSendEmailAction("tha_1"),
      createConnectAction("tha_2", "connect_google"),
    ];
    render(
      <InlineActionsList
        actions={actions}
        threadId="thr_123"
        onRunAction={vi.fn()}
        onDismissAction={vi.fn()}
      />
    );

    expect(screen.getByText(/Send Email/i)).toBeInTheDocument();
    expect(screen.queryByText(/Connect Google/i)).not.toBeInTheDocument();
  });

  it("renders up to 3 pending actions", () => {
    const actions = [
      createSendEmailAction("tha_1"),
      createSendEmailAction("tha_2"),
      createSendEmailAction("tha_3"),
    ];
    render(
      <InlineActionsList
        actions={actions}
        threadId="thr_123"
        onRunAction={vi.fn()}
        onDismissAction={vi.fn()}
      />
    );

    const cards = screen.getAllByText(/Send Email/i);
    expect(cards).toHaveLength(3);
  });

  it("shows '+N more' link when more than 3 actions", () => {
    const actions = [
      createSendEmailAction("tha_1"),
      createSendEmailAction("tha_2"),
      createSendEmailAction("tha_3"),
      createSendEmailAction("tha_4"),
      createSendEmailAction("tha_5"),
    ];
    render(
      <InlineActionsList
        actions={actions}
        threadId="thr_123"
        onRunAction={vi.fn()}
        onDismissAction={vi.fn()}
      />
    );

    expect(screen.getByText(/\+2 more/i)).toBeInTheDocument();
  });

  it("does not render connect actions inline (they stay in header)", () => {
    const actions = [createConnectAction("tha_1", "connect_google")];
    const { container } = render(
      <InlineActionsList
        actions={actions}
        threadId="thr_123"
        onRunAction={vi.fn()}
        onDismissAction={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("passes onRunAction to action cards", () => {
    const onRunAction = vi.fn();
    const actions = [createSendEmailAction("tha_1")];
    render(
      <InlineActionsList
        actions={actions}
        threadId="thr_123"
        onRunAction={onRunAction}
        onDismissAction={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /Approve/i })).toBeInTheDocument();
  });
});
