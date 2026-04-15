"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useImperativeHandle,
  forwardRef,
} from "react";
import type { Message, ThreadAction } from "@archastro/sdk";
import { ApiChatChannel } from "@archastro/sdk";
import type { Channel } from "@archastro/sdk/dist/phx_channel/channel.js";
import { useClient, useCurrentUser, useSocket } from "../hooks.js";
import { MessageList } from "./message-list.js";
import { ChatInput } from "./chat-input.js";
import { InlineActionsList } from "./inline-actions-list.js";
import { NativeTemplateModal } from "./native-template-modal.js";
import { useThreadHeader } from "./thread-context.js";
import { getPendingThreadActions } from "./thread-action-registry.js";
import type {
  ChatThreadProps,
  ChatLifecycleEvent,
  ChatThreadHandle,
  ChatThreadJumpRequest,
  ChatThreadJumpResult,
  MessageUploadInput,
  ThreadOwnerScope,
} from "./types.js";
import {
  clearSearchHighlights,
  findMatchingMessageId,
  highlightSearchTermInElement,
  normalizeSearchContent,
} from "./chat-search-utils.js";

const JOIN_TIMEOUT_MS = 15_000;
const DEFAULT_RELOAD_PREFIX = "archastro:chat:force_reload_at:";

async function withJoinTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Join timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function buildTopic(threadOwner: ThreadOwnerScope, threadId: string): string {
  if (threadOwner.type === "team") {
    return ApiChatChannel.topic1(threadOwner.teamId, threadId);
  }
  return ApiChatChannel.topic4(threadId);
}

const UNKNOWN_JUMP_TARGET = "unknown";

export const ChatThread = forwardRef<ChatThreadHandle, ChatThreadProps>(function ChatThread(
  {
    thread,
    initialMessages,
    actions: initialActions,
    renderMessage,
    onLifecycleEvent,
    placeholders,
    classNames,
    forceReloadStoragePrefix = DEFAULT_RELOAD_PREFIX,
    showSenderInfo,
  },
  ref,
) {
  const client = useClient();
  const socket = useSocket();
  const currentUser = useCurrentUser();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [actions, setActions] = useState<ThreadAction[]>(initialActions);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const messagesRef = useRef<Message[]>(initialMessages);
  const channelRef = useRef<Channel | null>(null);
  const chatChannelRef = useRef<ApiChatChannel | null>(null);
  const isFirstActionsLoadRef = useRef(true);
  const isConnectedRef = useRef<boolean>(false);
  const connectionErrorRef = useRef<string | null>(null);
  const rejoinInFlightRef = useRef<boolean>(false);
  const lastRejoinAttemptAtRef = useRef<number>(0);
  const retryCountRef = useRef<number>(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadProbeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const forceReloadScheduledRef = useRef<boolean>(false);
  const attemptRejoinRef = useRef<(reason: string) => Promise<void>>(
    async () => {},
  );
  const beforeCursorRef = useRef<string | undefined>(undefined);
  const hasMoreBeforeRef = useRef<boolean>(true);
  const loadingOlderRef = useRef(false);
  const jumpInFlightRef = useRef(false);
  const jumpPromiseRef = useRef<Promise<ChatThreadJumpResult> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const threadRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  useEffect(() => {
    connectionErrorRef.current = connectionError;
  }, [connectionError]);

  // Stable ref for the lifecycle callback so effects don't re-run on identity change
  const onLifecycleEventRef = useRef(onLifecycleEvent);
  useEffect(() => {
    onLifecycleEventRef.current = onLifecycleEvent;
  }, [onLifecycleEvent]);

  const emit = useCallback((event: ChatLifecycleEvent) => {
    onLifecycleEventRef.current?.(event);
  }, []);

  const clearHighlights = useCallback(() => {
    clearSearchHighlights(threadRootRef.current ?? document);
  }, []);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
      clearHighlights();
    };
  }, [clearHighlights]);

  // Modal state for native template actions
  const [modalAction, setModalAction] = useState<ThreadAction | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // WebSocket connection lifecycle
  // -------------------------------------------------------------------------

  const threadOwner: ThreadOwnerScope = useMemo(
    () => thread.team && !thread.user
      ? { type: "team", teamId: thread.team }
      : { type: "user" },
    [thread.team, thread.user],
  );

  useEffect(() => {
    let mounted = true;
    let unsubMessageAdded: (() => void) | null = null;
    let unsubMessageUpdated: (() => void) | null = null;
    let unsubThreadEvent: (() => void) | null = null;

    const topic = buildTopic(threadOwner, thread.id);

    const connect = async () => {
      try {
        if (!socket.isConnected) {
          await socket.connect();
        }

        const channel = socket.channel(topic);
        channelRef.current = channel;
        const chatChannel = new ApiChatChannel(channel);
        chatChannelRef.current = chatChannel;

        // Wire up event handlers
        unsubMessageAdded = chatChannel.onMessageAdded((payload: unknown) => {
          if (!mounted) return;
          const data = payload as { message?: Message };
          if (data?.message) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === data.message!.id)) return prev;
              return [...prev, data.message!];
            });
          }
        });

        unsubMessageUpdated = chatChannel.onMessageUpdated((payload: unknown) => {
          if (!mounted) return;
          const data = payload as Message;
          if (data?.id) {
            setMessages((prev) =>
              prev.map((m) => (m.id === data.id ? data : m)),
            );
          }
        });

        unsubThreadEvent = chatChannel.onThreadEvent((payload: unknown) => {
          if (!mounted) return;
          const data = payload as { event?: string; message?: Message };
          if (data?.event === "message_removed" && data.message?.id) {
            setMessages((prev) => prev.filter((m) => m.id !== data.message!.id));
          }
        });

        // Join the channel
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const joinResponse: any = await withJoinTimeout(
          channel.join(),
          JOIN_TIMEOUT_MS,
        );

        if (mounted) {
          setIsConnected(true);
          setConnectionError(null);
          emit({ type: "connected", threadId: thread.id });

          if (joinResponse?.paginated_messages?.messages) {
            setMessages(joinResponse.paginated_messages.messages);
            beforeCursorRef.current = joinResponse.paginated_messages.before_cursor;
            hasMoreBeforeRef.current = Boolean(joinResponse.paginated_messages.before_cursor);
          }
        }
      } catch (error) {
        console.error("[chat-thread] Failed to join thread:", error);
        if (mounted) {
          setConnectionError("Reconnecting...");
          emit({ type: "disconnected", threadId: thread.id, error: "Failed to join" });
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            void attemptRejoinRef.current("initial_connect");
          }, 3000);
        }
      }
    };

    connect();

    return () => {
      mounted = false;
      unsubMessageAdded?.();
      unsubMessageUpdated?.();
      unsubThreadEvent?.();
      const ch = channelRef.current;
      if (ch) {
        ch.leave().catch(() => {});
      }
      channelRef.current = null;
      chatChannelRef.current = null;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [socket, thread.id, threadOwner, emit]);

  // -------------------------------------------------------------------------
  // Rejoin logic
  // -------------------------------------------------------------------------

  const attemptRejoin = useCallback(
    async (reason: string) => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return;
      }

      const isAppResume =
        reason === "visibilitychange" || reason === "resume";
      if (
        !isAppResume &&
        isConnectedRef.current &&
        !connectionErrorRef.current
      ) {
        return;
      }

      const now = Date.now();
      if (
        rejoinInFlightRef.current ||
        now - lastRejoinAttemptAtRef.current < 1500
      ) {
        return;
      }
      rejoinInFlightRef.current = true;
      lastRejoinAttemptAtRef.current = now;

      try {
        // Leave old channel and create fresh one
        const oldChannel = channelRef.current;
        if (oldChannel) {
          try { await oldChannel.leave(); } catch { /* ignore */ }
        }

        const topic = buildTopic(threadOwner, thread.id);
        const channel = socket.channel(topic);
        channelRef.current = channel;
        chatChannelRef.current = new ApiChatChannel(channel);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const joinResponse: any = await withJoinTimeout(
          channel.join(),
          JOIN_TIMEOUT_MS,
        );

        setIsConnected(true);
        setConnectionError(null);
        emit({ type: "connected", threadId: thread.id });
        retryCountRef.current = 0;
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }

        if (joinResponse?.paginated_messages?.messages) {
          setMessages(joinResponse.paginated_messages.messages);
          beforeCursorRef.current = joinResponse.paginated_messages.before_cursor;
          hasMoreBeforeRef.current = Boolean(joinResponse.paginated_messages.before_cursor);
        }
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[chat-thread] Rejoin failed", { reason, error });
        }
        setIsConnected(false);
        emit({ type: "disconnected", threadId: thread.id, error: reason });

        const fastRetries = 3;
        const delays =
          retryCountRef.current < fastRetries
            ? [3000, 6000, 12000]
            : [30000];
        const delay =
          delays[Math.min(retryCountRef.current, delays.length - 1)];
        setConnectionError("Reconnecting...");
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          retryCountRef.current++;
          retryTimerRef.current = null;
          void attemptRejoin("retry");
        }, delay);
      } finally {
        rejoinInFlightRef.current = false;
      }
    },
    [socket, thread.id, threadOwner, emit],
  );

  attemptRejoinRef.current = attemptRejoin;

  // -------------------------------------------------------------------------
  // Force reload fallback
  // -------------------------------------------------------------------------

  const maybeForceReload = useCallback(
    (reason: string) => {
      if (forceReloadScheduledRef.current) {
        return;
      }

      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return;
      }

      const cooldownMs = 60_000;
      const reloadKey = `${forceReloadStoragePrefix}${thread.id}`;
      const now = Date.now();

      try {
        const lastReloadRaw = window.sessionStorage.getItem(reloadKey);
        const lastReloadAt = lastReloadRaw ? Number(lastReloadRaw) : 0;
        if (
          Number.isFinite(lastReloadAt) &&
          now - lastReloadAt < cooldownMs
        ) {
          return;
        }
        window.sessionStorage.setItem(reloadKey, String(now));
      } catch {
        // Ignore storage failures
      }

      forceReloadScheduledRef.current = true;
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          "[chat-thread] Forcing reload after reconnect remained unhealthy",
          { reason, threadId: thread.id },
        );
      }

      window.setTimeout(() => {
        window.location.reload();
      }, 500);
    },
    [thread.id, forceReloadStoragePrefix],
  );

  // -------------------------------------------------------------------------
  // Visibility / online listeners for rejoin
  // -------------------------------------------------------------------------

  useEffect(() => {
    const onResume = () => {
      retryCountRef.current = 0;
      void attemptRejoin("resume");
    };
    const onOnline = () => {
      retryCountRef.current = 0;
      void attemptRejoin("online");
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        retryCountRef.current = 0;
        void attemptRejoin("visibilitychange");
      }
    };

    window.addEventListener("focus", onResume);
    window.addEventListener("pageshow", onResume);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", onResume);
      window.removeEventListener("pageshow", onResume);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [attemptRejoin]);

  // -------------------------------------------------------------------------
  // Socket connected but chat still errored → force reload
  // -------------------------------------------------------------------------

  useEffect(() => {
    const unsubscribe = socket.onEvent((event: { type: string }) => {
      if (event.type !== "open") {
        return;
      }

      if (!connectionErrorRef.current || isConnectedRef.current) {
        return;
      }

      if (reloadProbeTimerRef.current) {
        clearTimeout(reloadProbeTimerRef.current);
      }

      reloadProbeTimerRef.current = setTimeout(() => {
        reloadProbeTimerRef.current = null;
        if (connectionErrorRef.current && !isConnectedRef.current) {
          maybeForceReload("socket_connected_but_chat_still_error");
        }
      }, 1000);
    });

    return () => {
      if (reloadProbeTimerRef.current) {
        clearTimeout(reloadProbeTimerRef.current);
        reloadProbeTimerRef.current = null;
      }
      unsubscribe?.();
    };
  }, [socket, maybeForceReload]);

  // -------------------------------------------------------------------------
  // Actions sync
  // -------------------------------------------------------------------------

  useEffect(() => {
    setActions(initialActions);
  }, [initialActions, thread.id]);

  useEffect(() => {
    // Skip the initial mount fetch — actions are already provided via SSR props.
    if (isFirstActionsLoadRef.current) {
      isFirstActionsLoadRef.current = false;
      return;
    }

    let cancelled = false;

    const refreshActions = async () => {
      try {
        // Thread actions API: GET /api/v1/threads/:id/actions
        const result = await client.http.request<{ data: ThreadAction[] }>(
          `/api/v1/threads/${thread.id}/actions`,
        );
        if (!cancelled) {
          setActions(result?.data ?? []);
        }
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[chat-thread] Failed to refresh actions", error);
        }
      }
    };

    refreshActions();

    return () => {
      cancelled = true;
    };
  }, [client, thread.id]);

  // -------------------------------------------------------------------------
  // Thread visible lifecycle event
  // -------------------------------------------------------------------------

  useEffect(() => {
    emit({ type: "thread_visible", threadId: thread.id });
  }, [thread.id, emit]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleSend = useCallback(async (content: string, _uploads?: MessageUploadInput[]) => {
    const chatChannel = chatChannelRef.current;
    if (!chatChannel) {
      throw new Error("Chat channel not ready");
    }
    // TODO: file upload support requires a separate upload endpoint
    await chatChannel.apiChatPostSimpleMessage({ content });
    emit({ type: "message_sent", threadId: thread.id, content });
  }, [thread.id, emit]);

  const handleRunAction = useCallback((action: ThreadAction) => {
    if (action.native_template?.component) {
      setModalAction(action);
    }
  }, []);

  const handleDismissAction = useCallback(
    async (action: ThreadAction) => {
      if (!action?.id) {
        return;
      }

      setActions((prev) =>
        prev.filter((candidate) => candidate.id !== action.id),
      );
      setModalAction((current: ThreadAction | null) =>
        current?.id === action.id ? null : current,
      );

      try {
        await client.http.request(
          `/api/v1/threads/${thread.id}/actions/${action.id}`,
          { method: "DELETE" },
        );

        emit({ type: "action_dismissed", threadId: thread.id, actionId: action.id });
        setSuccessToast("Dismissed");
        setTimeout(() => setSuccessToast(null), 2000);
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[chat-thread] Failed to dismiss action", error);
        }

        setErrorToast("Could not dismiss that action.");
        setTimeout(() => setErrorToast(null), 3000);
      } finally {
        try {
          const result = await client.http.request<{ data: ThreadAction[] }>(
            `/api/v1/threads/${thread.id}/actions`,
          );
          setActions(result?.data ?? []);
        } catch (error) {
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              "[chat-thread] Failed to refresh actions after dismiss",
              error,
            );
          }
        }
      }
    },
    [client, thread.id, emit],
  );

  const handleCompleteAction = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!modalAction?.id) {
        throw new Error("No action to complete");
      }

      const actionType = modalAction.type;

      await client.http.request(
        `/api/v1/threads/${thread.id}/actions/${modalAction.id}/complete`,
        { method: "POST", body: payload },
      );

      const result = await client.http.request<{ data: ThreadAction[] }>(
        `/api/v1/threads/${thread.id}/actions`,
      );
      setActions(result?.data ?? []);

      emit({
        type: "action_completed",
        threadId: thread.id,
        actionId: modalAction.id,
        actionType,
      });

      const toastMessage =
        actionType === "send_email" ? "Email sent" : "Action completed";
      setSuccessToast(toastMessage);
      setTimeout(() => setSuccessToast(null), 3000);
    },
    [client, thread.id, modalAction, emit],
  );

  // -------------------------------------------------------------------------
  // Header actions (non-native-template)
  // -------------------------------------------------------------------------

  const headerActions = useMemo(
    () =>
      getPendingThreadActions(actions).filter(
        (action) => !action.native_template?.component,
      ),
    [actions],
  );

  const { setThreadHeader, clearThreadHeader } = useThreadHeader();

  useEffect(() => {
    setThreadHeader({
      threadId: thread.id,
      teamId: thread.team,
      isConnected,
      connectionError,
      headerActions,
    });
  }, [
    thread.id,
    thread.team,
    isConnected,
    connectionError,
    headerActions,
    setThreadHeader,
  ]);

  useEffect(() => {
    return () => clearThreadHeader();
  }, [clearThreadHeader]);

  // -------------------------------------------------------------------------
  // Refresh actions after AI message completes
  // -------------------------------------------------------------------------

  const lastRefreshedMessageId = useRef<string | null>(null);
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage?.legacy_agent && !lastMessage?.agent) return;

    const metadata = lastMessage.metadata as
      | Record<string, unknown>
      | undefined;
    const isComplete = metadata?.complete === true;

    if (!isComplete || lastRefreshedMessageId.current === lastMessage.id)
      return;
    lastRefreshedMessageId.current = lastMessage.id;

    const refreshActions = async () => {
      try {
        const result = await client.http.request<{ data: ThreadAction[] }>(
          `/api/v1/threads/${thread.id}/actions`,
        );
        setActions(result?.data ?? []);
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            "[chat-thread] Failed to refresh actions after message",
            error,
          );
        }
      }
    };

    const timer = setTimeout(refreshActions, 500);
    return () => clearTimeout(timer);
  }, [messages, client, thread.id]);

  // -------------------------------------------------------------------------
  // Placeholder text
  // -------------------------------------------------------------------------

  const getInputPlaceholder = useCallback((): string => {
    if (!isConnected)
      return placeholders?.connecting ?? "Connecting...";

    if (messages.length === 0) {
      return (
        placeholders?.empty ??
        "Try: 'Help me organize my week' or 'What's on my calendar?'"
      );
    }

    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.legacy_agent || lastMessage?.agent) {
      return placeholders?.afterAgent ?? "Follow up or ask a question...";
    }

    return placeholders?.default ?? "Reply to your helper...";
  }, [isConnected, messages, placeholders]);

  const scrollToMessage = useCallback((
    messageId: string,
    highlightTerm?: string | null,
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      const selector = `[data-message-id="${messageId}"]`;
      let attempts = 0;
      const maxAttempts = 16;

      const run = () => {
        const target = document.querySelector(selector);
        if (target instanceof HTMLElement) {
          target.scrollIntoView({ behavior: "auto", block: "center" });
          clearHighlights();
          setActiveMessageId(messageId);
          highlightSearchTermInElement(target, highlightTerm);
          if (highlightTimerRef.current) {
            clearTimeout(highlightTimerRef.current);
            highlightTimerRef.current = null;
          }
          highlightTimerRef.current = setTimeout(() => {
            setActiveMessageId((current) =>
              current === messageId ? null : current,
            );
          }, 2000);
          resolve(true);
          return;
        }

        attempts += 1;
        if (attempts >= maxAttempts) {
          resolve(false);
          return;
        }

        window.requestAnimationFrame(run);
      };

      run();
    });
  }, [clearHighlights]);

  const loadOlderMessagesForScroll = useCallback(async (): Promise<boolean> => {
    const chatChannel = chatChannelRef.current;
    if (!chatChannel || loadingOlderRef.current) {
      return false;
    }

    const canLoadOlder = hasMoreBeforeRef.current || Boolean(beforeCursorRef.current);
    if (!canLoadOlder) {
      return false;
    }

    loadingOlderRef.current = true;
    setIsLoadingOlder(true);
    const previousTop = window.scrollY;
    const previousHeight = document.documentElement.scrollHeight;

    try {
      const request: Record<string, unknown> = { limit: 50 };
      if (beforeCursorRef.current) {
        request.before_cursor = beforeCursorRef.current;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = await chatChannel.apiChatLoadMoreMessages(request);
      const older: Message[] = result?.messages ?? [];

      if (older.length === 0) {
        hasMoreBeforeRef.current = false;
        return false;
      }

      setMessages((prev) => {
        const existing = new Set(prev.map((message) => message.id));
        const dedupedOlder = older.filter((message) => !existing.has(message.id));
        return [...dedupedOlder, ...prev];
      });

      beforeCursorRef.current = result?.before_cursor;
      hasMoreBeforeRef.current = Boolean(result?.has_more && result?.before_cursor);

      window.requestAnimationFrame(() => {
        const nextHeight = document.documentElement.scrollHeight;
        const delta = nextHeight - previousHeight;
        if (delta > 0) {
          window.scrollTo({ top: previousTop + delta, behavior: "auto" });
        }
      });

      return true;
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[chat-thread] Failed to load older messages", error);
      }
      return false;
    } finally {
      loadingOlderRef.current = false;
      setIsLoadingOlder(false);
    }
  }, []);

  const loadOlderUntilMessageFound = useCallback(
    async (messageId?: string | null, messageContent?: string | null): Promise<string | null> => {
      const chatChannel = chatChannelRef.current;
      if (!chatChannel) {
        return null;
      }

      const maxPages = 200;
      let pages = 0;
      let cursor = beforeCursorRef.current;

      while (pages < maxPages) {
        const request: Record<string, unknown> = { limit: 50 };
        if (cursor) {
          request.before_cursor = cursor;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any = await chatChannel.apiChatLoadMoreMessages(request);
        const older: Message[] = result?.messages ?? [];

        if (older.length === 0) {
          return null;
        }

        setMessages((prev) => {
          const existing = new Set(prev.map((message) => message.id));
          const dedupedOlder = older.filter(
            (message) => !existing.has(message.id),
          );
          return [...dedupedOlder, ...prev];
        });

        const matchingMessageId = findMatchingMessageId(older, {
          messageId,
          messageContent,
        });
        if (matchingMessageId) {
          beforeCursorRef.current = result?.before_cursor;
          return matchingMessageId;
        }

        const nextCursor = result?.before_cursor;
        if (!nextCursor || nextCursor === cursor) {
          hasMoreBeforeRef.current = false;
          return null;
        }

        cursor = nextCursor;
        beforeCursorRef.current = cursor;
        hasMoreBeforeRef.current = Boolean(result?.has_more && cursor);

        if (!result?.has_more) {
          hasMoreBeforeRef.current = false;
          return null;
        }

        pages += 1;
      }

      return null;
    },
    [],
  );

  useEffect(() => {
    const onScroll = () => {
      if (jumpInFlightRef.current || loadingOlderRef.current) {
        return;
      }

      if (window.scrollY > 220) {
        return;
      }

      void loadOlderMessagesForScroll();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [loadOlderMessagesForScroll]);

  const jumpToMessage = useCallback(
    async (request: ChatThreadJumpRequest): Promise<ChatThreadJumpResult> => {
      if (jumpPromiseRef.current) {
        return jumpPromiseRef.current;
      }

      const normalizedContent = normalizeSearchContent(request.messageContent);
      const jumpTargetKey =
        request.messageId ??
        (normalizedContent ? `content:${normalizedContent}` : null);

      if (!jumpTargetKey) {
        return {
          targetId:
            request.messageId ??
            request.messageContent ??
            UNKNOWN_JUMP_TARGET,
          found: false,
        };
      }

      const jumpPromise = (async (): Promise<ChatThreadJumpResult> => {
        jumpInFlightRef.current = true;

        try {
          const alreadyLoadedMessageId = findMatchingMessageId(messagesRef.current, {
            messageId: request.messageId,
            messageContent: normalizedContent,
          });

          if (alreadyLoadedMessageId) {
            const scrolled = await scrollToMessage(
              alreadyLoadedMessageId,
              request.highlightTerm,
            );
            return { targetId: alreadyLoadedMessageId, found: scrolled };
          }

          const foundMessageId = await loadOlderUntilMessageFound(
            request.messageId,
            normalizedContent,
          );
          if (!foundMessageId) {
            return { targetId: jumpTargetKey, found: false };
          }

          const scrolled = await scrollToMessage(
            foundMessageId,
            request.highlightTerm,
          );
          return { targetId: foundMessageId, found: scrolled };
        } catch {
          return { targetId: jumpTargetKey, found: false };
        } finally {
          jumpInFlightRef.current = false;
          jumpPromiseRef.current = null;
        }
      })();

      jumpPromiseRef.current = jumpPromise;
      return jumpPromise;
    },
    [loadOlderUntilMessageFound, scrollToMessage],
  );

  useImperativeHandle(
    ref,
    () => ({
      jumpToMessage,
      clearSearchHighlights: clearHighlights,
    }),
    [clearHighlights, jumpToMessage],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div ref={threadRootRef} className={classNames?.root}>
      {/* Messages — natural document flow */}
      <div
        className={classNames?.messageArea}
        style={!classNames?.messageArea ? { padding: "0.5rem 0.75rem", paddingBottom: "7rem" } : undefined}
      >
        {isLoadingOlder && (
          <div className="mb-3 text-center text-xs text-[var(--color-text-muted)]">
            Loading older messages...
          </div>
        )}
        <MessageList
          messages={messages}
          renderMessage={renderMessage}
          activeMessageId={activeMessageId}
          showSenderInfo={showSenderInfo}
          currentUserId={currentUser?.id}
        />
        <InlineActionsList
          actions={actions}
          threadId={thread.id}
          teamId={thread.team}
          onRunAction={handleRunAction}
          onDismissAction={handleDismissAction}
        />
      </div>

      {/* Input — fixed at bottom by default, normal flow when classNames provided */}
      <div
        className={classNames?.inputArea}
        style={
          !classNames?.inputArea
            ? {
                position: "fixed",
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 40,
                background: "white",
                paddingBottom: "env(safe-area-inset-bottom, 0px)",
              }
            : undefined
        }
      >
        <div
          className={classNames?.inputContainer}
          style={
            !classNames?.inputContainer
              ? { maxWidth: "64rem", marginLeft: "auto", marginRight: "auto", padding: "0.5rem 0.75rem" }
              : undefined
          }
        >
          <ChatInput
            onSend={handleSend}
            disabled={!isConnected}
            placeholder={getInputPlaceholder()}
          />
        </div>
      </div>

      {/* Native template modal */}
      <NativeTemplateModal
        open={modalAction !== null}
        action={modalAction}
        thread={thread}
        onClose={() => setModalAction(null)}
        onComplete={handleCompleteAction}
      />

      {/* Success toast */}
      {successToast && (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 transform">
          <div className="flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {successToast}
          </div>
        </div>
      )}

      {/* Error toast */}
      {errorToast && (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 transform">
          <div className="flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
            <svg
              className="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-11a.75.75 0 0 0-1.5 0v4a.75.75 0 0 0 1.5 0V7Zm-1.5 7a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"
                clipRule="evenodd"
              />
            </svg>
            {errorToast}
          </div>
        </div>
      )}
    </div>
  );
});

ChatThread.displayName = "ChatThread";
