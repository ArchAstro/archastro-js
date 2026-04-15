import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Thread, ThreadAction } from "@archastro/sdk";
import { NativeTemplateModal } from "../native-template-modal.js";

// Mock the NativeTemplateRenderer since it comes from an external package
vi.mock("@archastro/native-templates-react", () => ({
  NativeTemplateRenderer: ({ onAction, disabled, activeAction }: any) => (
    <div data-testid="native-template-renderer">
      <p>Mock Email Preview</p>
      <p>To: test@example.com</p>
      <p>Subject: Test Subject</p>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onAction({ name: "send", params: {} })}
        data-active={activeAction === "send"}
      >
        Send
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onAction({ name: "cancel", params: {} })}
      >
        Cancel
      </button>
    </div>
  ),
}));

function createThread(): Thread {
  return {
    id: "thr_123",
    title: "Test Thread",
    team: null,
  } as Thread;
}

function createSendEmailAction(): ThreadAction {
  return {
    id: "tha_123",
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
      props: {
        to: ["test@example.com"],
        subject: "Test Subject",
        body: "Test body",
      },
    },
  } as ThreadAction;
}

describe("NativeTemplateModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides modal content when not open", () => {
    render(
      <NativeTemplateModal
        open={false}
        action={createSendEmailAction()}
        thread={createThread()}
        onClose={vi.fn()}
      />
    );

    const modal = screen.getByText(/Review & Confirm/i).closest('[aria-hidden]');
    expect(modal).toHaveAttribute("aria-hidden", "true");
  });

  it("renders modal content when open", () => {
    render(
      <NativeTemplateModal
        open={true}
        action={createSendEmailAction()}
        thread={createThread()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/Review & Confirm/i)).toBeInTheDocument();
    expect(screen.getByText(/Send Email/i)).toBeInTheDocument();
    expect(screen.getByTestId("native-template-renderer")).toBeInTheDocument();
  });

  it("renders nothing when action has no native_template", () => {
    const actionWithoutTemplate = {
      ...createSendEmailAction(),
      native_template: undefined,
    };

    render(
      <NativeTemplateModal
        open={true}
        action={actionWithoutTemplate}
        thread={createThread()}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByText(/Review & Confirm/i)).not.toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <NativeTemplateModal
        open={true}
        action={createSendEmailAction()}
        thread={createThread()}
        onClose={onClose}
      />
    );

    const closeButton = screen.getByRole("button", { name: /close/i });
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when backdrop is clicked", () => {
    const onClose = vi.fn();
    render(
      <NativeTemplateModal
        open={true}
        action={createSendEmailAction()}
        thread={createThread()}
        onClose={onClose}
      />
    );

    const backdrop = screen.getByTestId("modal-backdrop");
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalled();
  });

  it("shows error message when completion fails", async () => {
    const mockCompleteAction = vi.fn().mockRejectedValue(new Error("Network error"));

    render(
      <NativeTemplateModal
        open={true}
        action={createSendEmailAction()}
        thread={createThread()}
        onClose={vi.fn()}
        onComplete={mockCompleteAction}
      />
    );

    const sendButton = screen.getByRole("button", { name: /send/i });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.getByText(/Network error/i)).toBeInTheDocument();
    });
  });

  it("calls onComplete with action payload when send is clicked", async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <NativeTemplateModal
        open={true}
        action={createSendEmailAction()}
        thread={createThread()}
        onClose={onClose}
        onComplete={onComplete}
      />
    );

    const sendButton = screen.getByRole("button", { name: /send/i });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "send",
        })
      );
    });
  });

  it("closes modal after successful completion", async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <NativeTemplateModal
        open={true}
        action={createSendEmailAction()}
        thread={createThread()}
        onClose={onClose}
        onComplete={onComplete}
      />
    );

    const sendButton = screen.getByRole("button", { name: /send/i });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });
});
