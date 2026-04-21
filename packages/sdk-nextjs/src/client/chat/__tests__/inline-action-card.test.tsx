import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { ThreadAction } from "../types.js";
import { InlineActionCard } from "../inline-action-card.js";

function createSendEmailAction(overrides: Partial<ThreadAction> = {}): ThreadAction {
  return {
    id: "tha_123",
    type: "send_email",
    status: "active",
    call_to_action: "Send: Pool Schedule",
    metadata: {
      action: "compose",
      to: ["wife@example.com"],
      subject: "Kids Pool Schedule",
      body: "Here are the swim times...",
      integration_id: "int_gmail_456",
    },
    native_template: {
      component: "EmailPreview",
      props: {
        to: ["wife@example.com"],
        subject: "Kids Pool Schedule",
        body: "Here are the swim times...",
      },
    },
    ...overrides,
  } as ThreadAction;
}

function createConnectGoogleAction(): ThreadAction {
  return {
    id: "tha_456",
    type: "connect_google",
    status: "active",
    call_to_action: "Connect Google",
    metadata: {},
  } as ThreadAction;
}

describe("InlineActionCard", () => {
  describe("send_email action with integration", () => {
    it("renders email preview with recipient and subject", () => {
      const action = createSendEmailAction();
      render(<InlineActionCard action={action} threadId="thr_123" onRun={vi.fn()} />);

      expect(screen.getByText(/Send Email/i)).toBeInTheDocument();
      expect(screen.getByText(/wife@example.com/i)).toBeInTheDocument();
      expect(screen.getByText(/Kids Pool Schedule/i)).toBeInTheDocument();
    });

    it("shows Approve button when action has native_template", () => {
      const action = createSendEmailAction();
      render(
        <InlineActionCard
          action={action}
          threadId="thr_123"
          onRun={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );

      expect(screen.getByRole("button", { name: /Approve/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Dismiss action/i })).toBeInTheDocument();
    });

    it("calls onRun when Approve button is clicked", () => {
      const action = createSendEmailAction();
      const onRun = vi.fn();
      render(<InlineActionCard action={action} threadId="thr_123" onRun={onRun} />);

      fireEvent.click(screen.getByRole("button", { name: /Approve/i }));

      expect(onRun).toHaveBeenCalledWith(action);
    });

    it("calls onDismiss when Dismiss is clicked", () => {
      const action = createSendEmailAction();
      const onDismiss = vi.fn();
      render(
        <InlineActionCard
          action={action}
          threadId="thr_123"
          onRun={vi.fn()}
          onDismiss={onDismiss}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /Dismiss action/i }));

      expect(onDismiss).toHaveBeenCalledWith(action);
    });
  });

  describe("send_email action without integration", () => {
    it("shows connect prompt when integration_id is missing", () => {
      const action = createSendEmailAction({
        metadata: {
          action: "compose",
          to: ["wife@example.com"],
          subject: "Kids Pool Schedule",
          body: "Here are the swim times...",
        },
      });
      render(<InlineActionCard action={action} threadId="thr_123" onRun={vi.fn()} />);

      expect(screen.getByText(/Go to Account settings to connect/i)).toBeInTheDocument();
    });

    it("shows Connect button instead of Approve when no integration", () => {
      const action = createSendEmailAction({
        metadata: {
          action: "compose",
          to: ["wife@example.com"],
          subject: "Kids Pool Schedule",
          body: "Here are the swim times...",
        },
      });
      render(<InlineActionCard action={action} threadId="thr_123" onRun={vi.fn()} />);

      expect(screen.getByRole("link", { name: /Account settings/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Approve/i })).not.toBeInTheDocument();
    });
  });

  describe("connect_google action", () => {
    it("renders connect prompt with correct label", () => {
      const action = createConnectGoogleAction();
      render(<InlineActionCard action={action} threadId="thr_123" onRun={vi.fn()} />);

      expect(screen.getByText(/Connect Google/i)).toBeInTheDocument();
    });

    it("renders as a link to the connector page", () => {
      const action = createConnectGoogleAction();
      render(<InlineActionCard action={action} threadId="thr_123" onRun={vi.fn()} />);

      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("href", expect.stringContaining("/connectors/google"));
    });
  });

  describe("completed actions", () => {
    it("shows completed state for done actions", () => {
      const action = createSendEmailAction({ status: "done" });
      render(<InlineActionCard action={action} threadId="thr_123" onRun={vi.fn()} />);

      expect(screen.getByText(/Sent/i)).toBeInTheDocument();
    });

    it("disables interaction for completed actions", () => {
      const action = createSendEmailAction({ status: "done" });
      const onRun = vi.fn();
      render(<InlineActionCard action={action} threadId="thr_123" onRun={onRun} />);

      const button = screen.queryByRole("button");
      if (button) {
        fireEvent.click(button);
        expect(onRun).not.toHaveBeenCalled();
      }
    });
  });
});
