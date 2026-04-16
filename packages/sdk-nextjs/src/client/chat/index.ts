// Components
export { ChatThread } from "./chat-thread.js";
export { ChatInput } from "./chat-input.js";
export { MessageList } from "./message-list.js";
export { InlineActionCard } from "./inline-action-card.js";
export { InlineActionsList } from "./inline-actions-list.js";

// Context
export {
  ThreadHeaderProvider,
  useThreadHeader,
  type ThreadHeaderState,
} from "./thread-context.js";

// Thread action utilities
export {
  isPendingThreadAction,
  getPendingThreadActions,
  getThreadActionPresentation,
  resolveThreadActionHref,
  getDomainFromAction,
  type ThreadActionSurface,
  type ThreadActionPresentation,
  type ResolveHrefOptions,
} from "./thread-action-registry.js";

// Types
export type {
  ChatThreadProps,
  ChatThreadHandle,
  ChatThreadJumpRequest,
  ChatThreadJumpResult,
  ChatThreadClassNames,
  ChatInputPlaceholders,
  ChatInputProps,
  MessageListProps,
  InlineActionCardProps,
  InlineActionsListProps,
  ChatLifecycleEvent,
  MessageRendererContext,
  DefaultMessageRenderer,
  DefaultMessageRendererOptions,
} from "./types.js";

export type { MessageUploadInput, ThreadOwnerScope } from "./types.js";
