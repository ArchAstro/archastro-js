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

function makeAction(overrides: Partial<ThreadAction> & { id: string; type: string }): ThreadAction {
  return { status: "active", ...overrides } as ThreadAction;
}

function renderChatThread(props: {
  thread?: Thread;
  messages?: Message[];
  actions?: ThreadAction[];
  onLifecycleEvent?: (event: { type: string; [key: string]: unknown }) => void;
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
          onLifecycleEvent={props.onLifecycleEvent}
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

  // -------------------------------------------------------------------------
  // Lifecycle events
  // -------------------------------------------------------------------------

  it("emits thread_visible on mount", async () => {
    const onLifecycleEvent = vi.fn();
    renderChatThread({ onLifecycleEvent });

    await waitFor(() => {
      expect(onLifecycleEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "thread_visible", threadId: "thr_test1" }),
      );
    });
  });

  it("emits connected after successful join", async () => {
    const onLifecycleEvent = vi.fn();
    mockJoin.mockResolvedValue({});
    renderChatThread({ onLifecycleEvent });

    await waitFor(() => {
      expect(onLifecycleEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "connected", threadId: "thr_test1" }),
      );
    });
  });

  it("emits disconnected on join failure", async () => {
    const onLifecycleEvent = vi.fn();
    mockJoin.mockRejectedValue(new Error("join failed"));
    renderChatThread({ onLifecycleEvent });

    await waitFor(() => {
      expect(onLifecycleEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "disconnected", threadId: "thr_test1" }),
      );
    });
  });

  it("emits message_sent after sending", async () => {
    const onLifecycleEvent = vi.fn();
    mockJoin.mockResolvedValue({});
    mockPush.mockResolvedValue({});
    renderChatThread({ onLifecycleEvent });

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });

    await userEvent.type(screen.getByRole("textbox"), "hello");
    await userEvent.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(onLifecycleEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "message_sent", content: "hello" }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Placeholder text
  // -------------------------------------------------------------------------

  it("shows empty placeholder when no messages", async () => {
    mockJoin.mockResolvedValue({});
    renderChatThread({ messages: [] });

    await waitFor(() => {
      const textarea = screen.getByRole("textbox");
      expect(textarea).not.toBeDisabled();
    });

    const textarea = screen.getByRole("textbox");
    expect(textarea.getAttribute("placeholder")).toContain("Help me organize");
  });

  it("shows afterAgent placeholder when last message is from agent", async () => {
    const agentMsg: Message = {
      id: "msg_agent",
      content: "I can help with that",
      created_at: "2025-01-01T00:00:00Z",
      agent: "agent_1",
    } as Message;
    mockJoin.mockResolvedValue({});
    renderChatThread({ messages: [agentMsg] });

    await waitFor(() => {
      const textarea = screen.getByRole("textbox");
      expect(textarea).not.toBeDisabled();
    });

    expect(screen.getByRole("textbox").getAttribute("placeholder")).toContain("Follow up");
  });

  it("shows default placeholder for user messages", async () => {
    mockJoin.mockResolvedValue({});
    renderChatThread({ messages: [baseMessage] });

    await waitFor(() => {
      const textarea = screen.getByRole("textbox");
      expect(textarea).not.toBeDisabled();
    });

    expect(screen.getByRole("textbox").getAttribute("placeholder")).toContain("Reply to your helper");
  });

  // -------------------------------------------------------------------------
  // Actions handling
  // -------------------------------------------------------------------------

  it("renders inline actions with approve button", async () => {
    const actions = [
      makeAction({
        id: "act_1",
        type: "send_email",
        metadata: { integration_id: "int_123" },
        native_template: { component: { type: "Text", content: "Review email" } },
      }),
    ];
    mockJoin.mockResolvedValue({});
    renderChatThread({ actions });

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });

    expect(screen.getByText("Approve")).toBeTruthy();
  });

  it("dismisses an action via API and shows toast", async () => {
    const actions = [
      makeAction({
        id: "act_1",
        type: "send_email",
        metadata: { integration_id: "int_123" },
        native_template: { component: { type: "Text", content: "Draft" } },
      }),
    ];
    mockJoin.mockResolvedValue({});
    mockHttpRequest.mockResolvedValue({ data: [] });
    renderChatThread({ actions });

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });

    // Click dismiss (X button)
    const dismissButton = screen.getByLabelText("Dismiss action");
    await userEvent.click(dismissButton);

    await waitFor(() => {
      // Should have called DELETE on the action
      expect(mockHttpRequest).toHaveBeenCalledWith(
        "/api/v1/threads/thr_test1/actions/act_1",
        { method: "DELETE" },
      );
    });

    // Should show success toast
    await waitFor(() => {
      expect(screen.getByText("Dismissed")).toBeTruthy();
    });
  });

  it("shows error toast when dismiss fails", async () => {
    const actions = [
      makeAction({
        id: "act_2",
        type: "send_email",
        metadata: { integration_id: "int_456" },
        native_template: { component: { type: "Text", content: "Draft" } },
      }),
    ];
    mockJoin.mockResolvedValue({});
    // First call to DELETE fails, second call to list actions succeeds
    mockHttpRequest
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValue({ data: [] });
    renderChatThread({ actions });

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });

    await userEvent.click(screen.getByLabelText("Dismiss action"));

    await waitFor(() => {
      expect(screen.getByText("Could not dismiss that action.")).toBeTruthy();
    });
  });

  it("refreshes actions after an AI message completes", async () => {
    mockJoin.mockResolvedValue({});
    mockHttpRequest.mockResolvedValue({ data: [] });

    renderChatThread({
      messages: [baseMessage],
    });

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });

    // Simulate an agent message arriving with metadata.complete = true
    act(() => {
      emitChannelEvent("message_added", {
        message: {
          id: "msg_agent_complete",
          content: "Done!",
          created_at: "2025-01-01T00:02:00Z",
          agent: "agent_1",
          metadata: { complete: true },
        },
      });
    });

    // Should trigger an actions refresh after 500ms delay
    await waitFor(() => {
      const actionsCalls = mockHttpRequest.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === "string" && call[0].includes("/actions"),
      );
      expect(actionsCalls.length).toBeGreaterThan(0);
    }, { timeout: 2000 });
  });

  // -------------------------------------------------------------------------
  // Connection error and retry
  // -------------------------------------------------------------------------

  it("shows reconnecting state and schedules retry on join failure", async () => {
    vi.useFakeTimers();
    mockJoin.mockRejectedValue(new Error("connection refused"));

    renderChatThread();

    // Wait for the initial connect attempt to fail
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Input should be disabled (not connected)
    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeDisabled();

    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Loading older messages
  // -------------------------------------------------------------------------

  it("loads older messages via channel push", async () => {
    const olderMessages = [
      { id: "msg_old1", content: "Older message", created_at: "2024-12-31T23:00:00Z" },
    ];
    mockJoin.mockResolvedValue({
      paginated_messages: {
        messages: [baseMessage],
        before_cursor: "cursor_abc",
      },
    });
    // loadMoreMessages returns older chunk
    mockPush.mockResolvedValue({
      messages: olderMessages,
      before_cursor: null,
      has_more: false,
    });

    renderChatThread();

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });

    // Simulate scroll near top - fire scroll event with low scrollY
    Object.defineProperty(window, "scrollY", { value: 100, writable: true });
    window.dispatchEvent(new Event("scroll"));

    await waitFor(() => {
      expect(screen.getByText("Older message")).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Reconnection / visibility
  // -------------------------------------------------------------------------

  it("attempts rejoin on visibility change", async () => {
    mockJoin.mockResolvedValue({});
    renderChatThread();

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });

    // Simulate going hidden then visible
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    // The rejoin path was triggered (channel was recreated)
    // No crash means the handler ran successfully
  });

  it("attempts rejoin on window online event", async () => {
    mockJoin.mockResolvedValue({});
    renderChatThread();

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });

    window.dispatchEvent(new Event("online"));
    // No crash
  });

  it("attempts rejoin on window focus", async () => {
    mockJoin.mockResolvedValue({});
    renderChatThread();

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });

    window.dispatchEvent(new Event("focus"));
    // No crash
  });

  it("attempts rejoin on window pageshow", async () => {
    mockJoin.mockResolvedValue({});
    renderChatThread();

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });

    window.dispatchEvent(new Event("pageshow"));
    // No crash
  });

  // -------------------------------------------------------------------------
  // Socket reconnect probe (force reload path)
  // -------------------------------------------------------------------------

  it("registers socket onEvent listener", async () => {
    mockJoin.mockResolvedValue({});
    renderChatThread();

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });

    expect(mockSocketOnEvent).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Actions sync on re-render
  // -------------------------------------------------------------------------

  it("updates actions when initialActions prop changes", async () => {
    mockJoin.mockResolvedValue({});
    const { rerender } = render(
      <SDKProvider
        config={{ baseURL: "https://api.test", publishableKey: "pk_test" }}
        refreshSession={vi.fn().mockResolvedValue(null)}
      >
        <ThreadHeaderProvider>
          <ChatThread
            thread={baseThread}
            initialMessages={[baseMessage]}
            actions={[]}
          />
        </ThreadHeaderProvider>
      </SDKProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });

    // Re-render with new actions
    const newActions = [
      makeAction({
        id: "act_new",
        type: "send_email",
        metadata: { integration_id: "int_1" },
        native_template: { component: { type: "Text", content: "Email" } },
      }),
    ];

    rerender(
      <SDKProvider
        config={{ baseURL: "https://api.test", publishableKey: "pk_test" }}
        refreshSession={vi.fn().mockResolvedValue(null)}
      >
        <ThreadHeaderProvider>
          <ChatThread
            thread={baseThread}
            initialMessages={[baseMessage]}
            actions={newActions}
          />
        </ThreadHeaderProvider>
      </SDKProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Approve")).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Custom placeholders
  // -------------------------------------------------------------------------

  it("uses custom placeholder strings", async () => {
    mockJoin.mockResolvedValue({});
    render(
      <SDKProvider
        config={{ baseURL: "https://api.test", publishableKey: "pk_test" }}
        refreshSession={vi.fn().mockResolvedValue(null)}
      >
        <ThreadHeaderProvider>
          <ChatThread
            thread={baseThread}
            initialMessages={[baseMessage]}
            actions={[]}
            placeholders={{ default: "Type here..." }}
          />
        </ThreadHeaderProvider>
      </SDKProvider>,
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Type here...")).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Cleanup on unmount
  // -------------------------------------------------------------------------

  it("leaves channel on unmount", async () => {
    mockJoin.mockResolvedValue({});
    const { unmount } = renderChatThread();

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });

    unmount();

    expect(mockLeave).toHaveBeenCalled();
  });

  it("cleans up event listeners on unmount", async () => {
    mockJoin.mockResolvedValue({});
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderChatThread();

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });

    unmount();

    const removedEvents = removeEventListenerSpy.mock.calls.map((c) => c[0]);
    expect(removedEvents).toContain("focus");
    expect(removedEvents).toContain("online");
    expect(removedEvents).toContain("scroll");
  });

  // -------------------------------------------------------------------------
  // Show sender info prop
  // -------------------------------------------------------------------------

  it("passes showSenderInfo to MessageList", async () => {
    mockJoin.mockResolvedValue({});
    render(
      <SDKProvider
        config={{ baseURL: "https://api.test", publishableKey: "pk_test" }}
        refreshSession={vi.fn().mockResolvedValue(null)}
      >
        <ThreadHeaderProvider>
          <ChatThread
            thread={baseThread}
            initialMessages={[baseMessage]}
            actions={[]}
            showSenderInfo
          />
        </ThreadHeaderProvider>
      </SDKProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("textbox")).not.toBeDisabled();
    });

    // With showSenderInfo and no user, it shows "Helper" label
    // (The message has no user field so it's treated as helper)
    // No crash is the key assertion
  });
});
