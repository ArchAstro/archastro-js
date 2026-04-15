import type { ReactNode } from "react";
import type { Thread, Message, ThreadAction } from "@archastro/sdk";

/** File upload descriptor for chat messages. */
export interface MessageUploadInput {
  name: string;
  mime_type: string;
  content: Blob;
}

/** Discriminated union describing thread ownership scope. */
export type ThreadOwnerScope =
  | { type: "user" }
  | { type: "team"; teamId: string };

// ---------------------------------------------------------------------------
// Lifecycle events
// ---------------------------------------------------------------------------

/** Union of all events emitted by ChatThread during its lifecycle. */
export type ChatLifecycleEvent =
  | { type: "thread_visible"; threadId: string }
  | { type: "connected"; threadId: string }
  | { type: "disconnected"; threadId: string; error: string | null }
  | { type: "message_sent"; threadId: string; content: string }
  | {
      type: "action_completed";
      threadId: string;
      actionId: string;
      actionType: string;
    }
  | { type: "action_dismissed"; threadId: string; actionId: string };

// ---------------------------------------------------------------------------
// Message renderer override
// ---------------------------------------------------------------------------

/** Context passed to a custom `renderMessage` function. */
export interface MessageRendererContext {
  /** True when the message is from an AI agent / helper (not a user). */
  isHelper: boolean;
  /** True when the message was sent by the currently authenticated user. */
  isSelf: boolean;
  /** Pre-formatted local time string for the message. */
  formattedTime: string;
  /** Copy the message content to the clipboard. */
  onCopy: () => void;
  /** True for 2 s after a successful copy. */
  isCopied: boolean;
}

/** Options accepted by the default message bubble renderer. */
export interface DefaultMessageRendererOptions {
  /** Extra elements rendered in the footer action row (next to the copy button). */
  extraActions?: ReactNode;
  /** Override the sender name displayed above the message bubble. */
  senderName?: string;
}

/**
 * Render function for the default message bubble.
 * Call this inside a custom `renderMessage` to fall back to the built-in UI
 * (useful when you only want to override specific messages).
 */
export type DefaultMessageRenderer = (options?: DefaultMessageRendererOptions) => ReactNode;

// ---------------------------------------------------------------------------
// ChatThread props
// ---------------------------------------------------------------------------

export interface ChatThreadProps {
  /** The thread to display. */
  thread: Thread;
  /** Messages loaded on the server (SSR). */
  initialMessages: Message[];
  /** Thread actions loaded on the server. */
  actions: ThreadAction[];

  // -- Optional customization -------------------------------------------------

  /**
   * Override the default message bubble renderer.
   *
   * Called for every visible message. Return your own JSX, or call
   * `DefaultBubble()` to render the built-in bubble (handy for wrapping or
   * conditionally overriding).
   *
   * @example
   * ```tsx
   * renderMessage={(message, ctx, DefaultBubble) => {
   *   if (ctx.isHelper) {
   *     return (
   *       <div>
   *         {DefaultBubble()}
   *         <MyCustomFooter message={message} />
   *       </div>
   *     );
   *   }
   *   return DefaultBubble();
   * }}
   * ```
   */
  renderMessage?: (
    message: Message,
    context: MessageRendererContext,
    DefaultBubble: DefaultMessageRenderer,
  ) => ReactNode;

  /**
   * Receive typed lifecycle events from the chat thread.
   *
   * Use this for analytics, ad conversion tracking, logging, or any
   * side-effect that should fire in response to chat activity.
   */
  onLifecycleEvent?: (event: ChatLifecycleEvent) => void;

  /** Override the default input placeholder strings. */
  placeholders?: ChatInputPlaceholders;

  /** Override CSS classes on key layout elements. */
  classNames?: ChatThreadClassNames;

  /**
   * Prefix used for the force-reload sessionStorage key.
   * Defaults to `"archastro:chat:force_reload_at:"`.
   */
  forceReloadStoragePrefix?: string;

  /** Show sender profile picture and name above message bubbles. Disabled by default. */
  showSenderInfo?: boolean;

}

export interface ChatThreadJumpRequest {
  /**
   * Preferred target message id. If unavailable, `messageContent` is used as fallback.
   */
  messageId?: string | null;
  /**
   * Fallback snippet used when message ID mapping is unavailable.
   */
  messageContent?: string | null;
  /**
   * Optional term to highlight inside the located message.
   */
  highlightTerm?: string | null;
}

export interface ChatThreadJumpResult {
  targetId: string;
  found: boolean;
}

export interface ChatThreadHandle {
  /**
   * Locate a message in loaded history (fetching older pages when needed) and scroll to it.
   */
  jumpToMessage: (request: ChatThreadJumpRequest) => Promise<ChatThreadJumpResult>;
  /**
   * Clear in-message term highlights produced by jumpToMessage.
   */
  clearSearchHighlights: () => void;
}

// ---------------------------------------------------------------------------
// Sub-types
// ---------------------------------------------------------------------------

export interface ChatInputPlaceholders {
  /** Shown while the WebSocket is connecting. Default: `"Connecting..."` */
  connecting?: string;
  /** Shown when there are no messages yet. */
  empty?: string;
  /** Shown after the last message is from an agent. */
  afterAgent?: string;
  /** Default placeholder. */
  default?: string;
}

export interface ChatThreadClassNames {
  /** Wraps the entire chat thread. */
  root?: string;
  /** Wraps the message list + inline actions area. */
  messageArea?: string;
  /** Fixed bottom bar containing the input. */
  inputArea?: string;
  /** Inner container of the input bar. */
  inputContainer?: string;
}

// ---------------------------------------------------------------------------
// MessageList props
// ---------------------------------------------------------------------------

export interface MessageListProps {
  messages: Message[];
  /** Custom message renderer (passed through from ChatThreadProps). */
  renderMessage?: ChatThreadProps["renderMessage"];
  /** Optional message ID to visually emphasize after jump-to-message. */
  activeMessageId?: string | null;
  /** Show sender profile picture and name above message bubbles. Disabled by default. */
  showSenderInfo?: boolean;
  /** ID of the currently authenticated user. Used to distinguish "my" messages from other users'. */
  currentUserId?: string;
}

// ---------------------------------------------------------------------------
// ChatInput props
// ---------------------------------------------------------------------------

export interface ChatInputProps {
  onSend: (content: string, uploads?: MessageUploadInput[]) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
}

// ---------------------------------------------------------------------------
// InlineAction props
// ---------------------------------------------------------------------------

export interface InlineActionCardProps {
  action: ThreadAction;
  threadId: string;
  teamId?: string | null;
  onRun: (action: ThreadAction) => void;
  onDismiss?: (action: ThreadAction) => void;
  /**
   * URL for the "Connect" link when an email action lacks an integration.
   * Defaults to `"/account?integration=google"`.
   */
  connectHref?: string;
}

export interface InlineActionsListProps {
  actions: ThreadAction[];
  threadId: string;
  teamId?: string | null;
  onRunAction: (action: ThreadAction) => void;
  onDismissAction: (action: ThreadAction) => void;
  /**
   * Maximum number of inline actions to show before a "+N more" link.
   * Defaults to 3.
   */
  maxVisible?: number;
  /**
   * Generates the href for the "+N more" overflow link.
   * Receives threadId. Defaults to `/account?thread_id=...&return_to=...`.
   */
  overflowHref?: (threadId: string) => string;
}

// ---------------------------------------------------------------------------
// NativeTemplateModal props
// ---------------------------------------------------------------------------

export interface NativeTemplateModalProps {
  open: boolean;
  action: ThreadAction | null;
  thread: Thread | null;
  onClose: () => void;
  onComplete?: (payload: Record<string, unknown>) => Promise<void>;
}

// ---------------------------------------------------------------------------
// CSS variable reference (for theming documentation)
// ---------------------------------------------------------------------------
// Components use CSS custom properties for colors. Set these in your app's
// CSS to customize the look and feel:
//
//   --color-accent         Primary action color (buttons, links)
//   --color-accent-light   Light variant of accent (backgrounds)
//   --color-text           Primary text color
//   --color-text-muted     Secondary/muted text
//   --color-warm-gray      Background for helper bubbles
//   --color-border         Border color
//
// Example:
//   :root {
//     --color-accent: #7c3aed;
//     --color-accent-light: #ede9fe;
//     --color-text: #1e293b;
//     --color-text-muted: #64748b;
//     --color-warm-gray: #f8f7f4;
//     --color-border: #e2e0dc;
//   }
