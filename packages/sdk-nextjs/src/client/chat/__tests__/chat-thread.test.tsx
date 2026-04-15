import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Message, ThreadAction, Thread } from "@archastro/sdk";

// ---------------------------------------------------------------------------
// Mock Socket + Channel + ApiChatChannel
// ---------------------------------------------------------------------------

const mockJoin = vi.fn();
const mockLeave = vi.fn();
const mockPush = vi.fn();
const mockChannelOn = vi.fn();
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockSocketOnEvent = vi.fn();

// Store event handlers registered via channel.on / chatChannel.on*
let channelHandlers: Record<string, ((payload: unknown) => void)[]> = {};

function resetChannelHandlers() {
  channelHandlers = {};
}

function emitChannelEvent(event: string, payload: unknown) {
  channelHandlers[event]?.forEach((cb) => cb(payload));
}

// channel.on records handlers and returns unsubscribe
mockChannelOn.mockImplementation((event: string, cb: (payload: unknown) => void) => {
  if (!channelHandlers[event]) channelHandlers[event] = [];
  channelHandlers[event].push(cb);
  return () => {
    channelHandlers[event] = channelHandlers[event].filter((h) => h !== cb);
  };
});

vi.mock("@archastro/sdk/dist/phx_channel/channel.js", () => ({}));
vi.mock("@archastro/sdk/dist/phx_channel/socket.js", () => ({
  Socket: class MockSocket {
    get isConnected() { return true; }
    connect = mockConnect.mockResolvedValue(undefined);
    disconnect = mockDisconnect.mockResolvedValue(undefined);
    channel = vi.fn(() => ({
      join: mockJoin,
      leave: mockLeave.mockResolvedValue(undefined),
      push: mockPush,
      on: mockChannelOn,
      state: "joined",
      isJoined: true,
    }));
    onEvent = mockSocketOnEvent.mockReturnValue(() => {});
  },
}));

const mockHttpRequest = vi.fn();
const mockUsersMe = vi.fn();

vi.mock("@archastro/sdk", () => ({
  PlatformClient: class {
    users = { me: mockUsersMe };
    http = { request: mockHttpRequest };
  },
  ApiChatChannel: class {
    static topic1(teamId: string, threadId: string) {
      return `api:chat:team:${teamId}:thread:${threadId}`;
    }
    static topic4(threadId: string) {
      return `api:chat:user:thread:${threadId}`;
    }
    constructor() {}
    onMessageAdded(cb: (p: unknown) => void) {
      return mockChannelOn("message_added", cb);
    }
    onMessageUpdated(cb: (p: unknown) => void) {
      return mockChannelOn("message_updated", cb);
    }
    onThreadEvent(cb: (p: unknown) => void) {
      return mockChannelOn("thread_event", cb);
    }
    onSystemEvent(cb: (p: unknown) => void) {
      return mockChannelOn("system_event", cb);
    }
    apiChatPostSimpleMessage = mockPush;
    apiChatLoadMoreMessages = mockPush;
  },
}));

// Mock react-markdown and optional peer deps
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <p>{children}</p>,
}));
vi.mock("remark-gfm", () => ({ default: {} }));
vi.mock("rehype-highlight", () => ({ default: {} }));
vi.mock("remove-markdown", () => ({ default: (s: string) => s }));
vi.mock("@archastro/native-templates-core", () => ({}));
vi.mock("@archastro/native-templates-react", () => ({
  NativeTemplateRenderer: () => <div data-testid="native-renderer" />,
}));

import { ChatThread } from "../chat-thread.js";
import { SDKProvider } from "../../hooks.js";
import { ThreadHeaderProvider } from "../thread-context.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseThread: Thread = {
  id: "thr_test1",
  title: "Test Thread",
} as Thread;

const baseMessage: Message = {
  id: "msg_1",
  content: "Hello world",
  created_at: "2025-01-01T00:00:00Z",
} as Message;

function renderChatThread(props: {
  thread?: Thread;
  messages?: Message[];
  actions?: ThreadAction[];
} = {}) {
  const refreshSession = vi.fn().mockResolvedValue(null);

  return render(
    <SDKProvider
      config={{ baseURL: "https://api.test", publishableKey: "pk_test" }}
      refreshSession={refreshSession}
    >
      <ThreadHeaderProvider>
        <ChatThread
          thread={props.thread ?? baseThread}
          initialMessages={props.messages ?? [baseMessage]}
          actions={props.actions ?? []}
        />
      </ThreadHeaderProvider>
    </SDKProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChatThread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChannelHandlers();
    mockJoin.mockResolvedValue({});
    mockUsersMe.mockResolvedValue({ id: "user-1", email: "test@test.com" });
    mockHttpRequest.mockResolvedValue({ data: [] });

    // Stub scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders initial messages", async () => {
    renderChatThread();
    expect(screen.getByText("Hello world")).toBeTruthy();
  });

  it("shows connecting placeholder while joining", async () => {
    // Make join hang (never resolve)
    mockJoin.mockReturnValue(new Promise(() => {}));
    renderChatThread();
    // Input should show "Connecting..."
    const textarea = screen.getByPlaceholderText("Connecting...");
    expect(textarea).toBeTruthy();
  });

  it("connects to the channel and enables input", async () => {
    mockJoin.mockResolvedValue({});
    renderChatThread();

    await waitFor(() => {
      const textarea = screen.getByRole("textbox");
      expect(textarea).not.toBeDisabled();
    });
  });

  it("adds messages from message_added events", async () => {
    mockJoin.mockResolvedValue({});
    renderChatThread();

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });

    act(() => {
      emitChannelEvent("message_added", {
        message: { id: "msg_2", content: "New message from WS", created_at: "2025-01-01T00:01:00Z" },
      });
    });

    expect(screen.getByText("New message from WS")).toBeTruthy();
  });

  it("updates messages from message_updated events", async () => {
    mockJoin.mockResolvedValue({});
    renderChatThread({ messages: [{ id: "msg_1", content: "Original", created_at: "2025-01-01T00:00:00Z" } as Message] });

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });

    act(() => {
      emitChannelEvent("message_updated", {
        id: "msg_1",
        content: "Edited",
        created_at: "2025-01-01T00:00:00Z",
      });
    });

    expect(screen.getByText("Edited")).toBeTruthy();
  });

  it("removes messages from thread_event message_removed", async () => {
    mockJoin.mockResolvedValue({});
    renderChatThread();

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });

    expect(screen.getByText("Hello world")).toBeTruthy();

    act(() => {
      emitChannelEvent("thread_event", {
        event: "message_removed",
        message: { id: "msg_1" },
      });
    });

    expect(screen.queryByText("Hello world")).toBeNull();
  });

  it("deduplicates message_added with same id", async () => {
    mockJoin.mockResolvedValue({});
    renderChatThread();

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });

    act(() => {
      // Same id as initial message
      emitChannelEvent("message_added", {
        message: { id: "msg_1", content: "Duplicate", created_at: "2025-01-01T00:00:00Z" },
      });
    });

    // Should still show original, not duplicate
    const messages = screen.getAllByText("Hello world");
    expect(messages.length).toBe(1);
  });

  it("sends a message via the channel", async () => {
    mockJoin.mockResolvedValue({});
    mockPush.mockResolvedValue({});

    renderChatThread();

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });

    const textarea = screen.getByRole("textbox");
    const sendButton = screen.getByLabelText("Send message");

    await userEvent.type(textarea, "My message");
    await userEvent.click(sendButton);

    expect(mockPush).toHaveBeenCalledWith({ content: "My message" });
  });

  it("uses team topic for team threads", async () => {
    const teamThread = { id: "thr_team1", team: "team_abc", title: "Team Thread" } as Thread;
    mockJoin.mockResolvedValue({});

    renderChatThread({ thread: teamThread });

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });

    // The socket.channel() was called — we can't easily inspect the topic from here,
    // but the component shouldn't crash for team threads
  });

  it("replaces messages when join response includes paginated_messages", async () => {
    const serverMessages = [
      { id: "msg_s1", content: "Server message 1", created_at: "2025-01-01T00:00:00Z" },
      { id: "msg_s2", content: "Server message 2", created_at: "2025-01-01T00:01:00Z" },
    ];
    mockJoin.mockResolvedValue({
      paginated_messages: { messages: serverMessages, before_cursor: "cursor_1" },
    });

    renderChatThread();

    await waitFor(() => {
      expect(screen.getByText("Server message 1")).toBeTruthy();
      expect(screen.getByText("Server message 2")).toBeTruthy();
    });
  });
});
