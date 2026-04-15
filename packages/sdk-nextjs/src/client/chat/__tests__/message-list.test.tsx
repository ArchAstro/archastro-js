import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import type { Message } from "@archastro/sdk";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <p>{children}</p>,
}));
vi.mock("remark-gfm", () => ({ default: () => {} }));
vi.mock("remove-markdown", () => ({ default: (s: string) => s }));

import { MessageList } from "../message-list.js";

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg_1",
    content: "Hello",
    team: "team_1",
    created_at: new Date().toISOString(),
    user: "usr_1",
    ...overrides,
  } as Message;
}

describe("MessageList isSelf and alignment", () => {
  it("right-aligns messages from the current user", () => {
    const message = createMessage({ id: "msg_self", content: "My message", user: "usr_1" });
    const { container } = render(
      <MessageList messages={[message]} currentUserId="usr_1" />,
    );
    const wrapper = container.querySelector('[class*="justify-end"]');
    expect(wrapper).toBeInTheDocument();
  });

  it("left-aligns messages from other users when currentUserId is set", () => {
    const message = createMessage({ id: "msg_other", content: "Their message", user: "usr_2" });
    const { container } = render(
      <MessageList messages={[message]} currentUserId="usr_1" showSenderInfo />,
    );
    const wrapper = container.querySelector('[class*="justify-start"]');
    expect(wrapper).toBeInTheDocument();
  });

  it("left-aligns all user messages when currentUserId is undefined", () => {
    const message = createMessage({ id: "msg_no_uid", content: "Unknown sender", user: "usr_1" });
    const { container } = render(
      <MessageList messages={[message]} currentUserId={undefined} />,
    );
    // Should NOT right-align when we don't know who the current user is
    const rightAligned = container.querySelector('[class*="justify-end"]');
    expect(rightAligned).not.toBeInTheDocument();
    const leftAligned = container.querySelector('[class*="justify-start"]');
    expect(leftAligned).toBeInTheDocument();
  });

  it("shows sender name for other users' messages when showSenderInfo is true", () => {
    const message = createMessage({
      id: "msg_named",
      content: "Hello from Beth",
      user: { id: "usr_2", name: "Beth", email: "beth@example.com" } as any,
    });
    render(
      <MessageList messages={[message]} currentUserId="usr_1" showSenderInfo />,
    );
    expect(screen.getByText("Beth")).toBeInTheDocument();
  });

  it("uses gray background for other users' messages, accent for self", () => {
    const otherMsg = createMessage({ id: "msg_other_color", content: "Other", user: "usr_2" });
    const selfMsg = createMessage({ id: "msg_self_color", content: "Self", user: "usr_1" });
    const { container } = render(
      <MessageList messages={[otherMsg, selfMsg]} currentUserId="usr_1" showSenderInfo />,
    );
    const bubbles = container.querySelectorAll('[class*="rounded-2xl"]');
    // Other user's bubble should be gray (warm-gray), not accent
    const otherBubble = Array.from(bubbles).find((b) => b.textContent?.includes("Other"));
    expect(otherBubble?.className).toContain("warm-gray");
    expect(otherBubble?.className).not.toContain("accent");
    // Self bubble should be accent
    const selfBubble = Array.from(bubbles).find((b) => b.textContent?.includes("Self"));
    expect(selfBubble?.className).toContain("accent");
  });

  it("does not show sender name for self messages", () => {
    const message = createMessage({
      id: "msg_self_named",
      content: "My own message",
      user: { id: "usr_1", name: "Alice" } as any,
    });
    render(
      <MessageList messages={[message]} currentUserId="usr_1" showSenderInfo />,
    );
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
  });
});

describe("MessageList attachment rendering", () => {
  it("renders image attachments as img elements", () => {
    const message = createMessage({
      id: "msg_img",
      content: "Check this out",
      user: undefined,
      legacy_agent: "agent_1",
      attachments: [
        {
          id: "att_1",
          type: "image",
          filename: "photo.png",
          content_type: "image/png",
          url: "https://example.com/photo.png",
        },
      ],
    });

    render(<MessageList messages={[message]} />);

    const img = screen.getByRole("img", { name: "photo.png" });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://example.com/photo.png");
    expect(img).toHaveAttribute("alt", "photo.png");
  });

  it("renders file attachments as download links", () => {
    const message = createMessage({
      id: "msg_pdf",
      content: "Here is the report",
      attachments: [
        {
          id: "att_2",
          type: "file",
          filename: "report.pdf",
          content_type: "application/pdf",
          url: "https://example.com/report.pdf",
        },
      ],
    });

    render(<MessageList messages={[message]} />);

    expect(screen.getByText("report.pdf")).toBeInTheDocument();

    const link = screen.getByText("report.pdf").closest("a");
    expect(link).toHaveAttribute("href", "https://example.com/report.pdf");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("renders messages without attachments normally", () => {
    const message = createMessage({
      id: "msg_plain",
      content: "Just a plain message",
    });

    render(<MessageList messages={[message]} />);

    expect(screen.getByText("Just a plain message")).toBeInTheDocument();
    // Should not have any img elements
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
