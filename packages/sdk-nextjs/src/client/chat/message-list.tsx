"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Message } from "@archastro/sdk";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import removeMarkdown from "remove-markdown";
import { parseServerTimestamp } from "../utils/datetime.js";
import type { MessageListProps, MessageRendererContext, DefaultMessageRendererOptions } from "./types.js";

// Code blocks in agent messages are syntax-highlighted via rehype-highlight
// (required peer dep). Consumers must import a highlight.js theme stylesheet
// themselves so they can choose the theme — recommended:
//
//   import "highlight.js/styles/github.css";
//
// Importing CSS as a side effect from a published library breaks bundlers
// without a CSS loader and removes the consumer's ability to override.

/** Extract a string ID from a field that may be a string ID or an expanded object with `.id`. */
function resolveId(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) return (value as { id: string }).id;
  return undefined;
}

export function MessageList({ messages, renderMessage, activeMessageId, showSenderInfo, currentUserId }: MessageListProps) {
  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef(true);
  const previousLastMessageId = useRef<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const lastMessage = messages[messages.length - 1];
  const lastAgentStatus =
    lastMessage && (lastMessage.legacy_agent || lastMessage.agent)
      ? parseAgentTag(lastMessage.content)
      : null;
  const showAgentWorkingIndicator =
    Boolean(lastAgentStatus) &&
    (lastMessage?.legacy_agent || lastMessage?.agent) &&
    !isMessageComplete(lastMessage);

  const visibleMessages = messages.filter(
    (message) => !isAgentStatusMessage(message),
  );

  useEffect(() => {
    if (messages.length === 0) {
      previousLastMessageId.current = null;
      return;
    }

    const currentLastMessageId = messages[messages.length - 1]?.id ?? null;

    if (isInitialMount.current) {
      endOfMessagesRef.current?.scrollIntoView({ behavior: "instant" });
      isInitialMount.current = false;
    } else if (
      previousLastMessageId.current !== null &&
      currentLastMessageId !== previousLastMessageId.current
    ) {
      endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
    }

    previousLastMessageId.current = currentLastMessageId;
  }, [messages]);

  const handleCopy = async (messageId: string, content: string) => {
    try {
      const plainText = removeMarkdown(content);
      await navigator.clipboard.writeText(plainText);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  if (messages.length === 0) {
    return (
      <div className="py-12 text-center text-[var(--color-text-muted)]">
        No messages yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {visibleMessages.map((message) => {
        const isHelper = !message.user || !!message.legacy_agent || !!message.agent;
        const isSelf = !isHelper && !!currentUserId && resolveId(message.user) === currentUserId;
        const isCopied = copiedMessageId === message.id;
        const context: MessageRendererContext = {
          isHelper,
          isSelf,
          formattedTime: formatTime(message.created_at),
          onCopy: () => handleCopy(message.id, message.content || ""),
          isCopied,
        };

        const defaultBubble = (options?: DefaultMessageRendererOptions) => (
          <MessageBubble
            key={message.id}
            message={message}
            onCopy={handleCopy}
            isCopied={isCopied}
            extraActions={options?.extraActions}
            senderNameOverride={options?.senderName}
            showSenderInfo={showSenderInfo}
            currentUserId={currentUserId}
          />
        );

        const isActive = activeMessageId === message.id;

        if (renderMessage) {
          return (
            <div
              key={message.id}
              data-message-id={message.id}
              className={
                isActive
                  ? "rounded-xl ring-2 ring-[var(--color-accent)]/50 ring-offset-2 ring-offset-transparent transition-shadow"
                  : undefined
              }
            >
              {renderMessage(message, context, defaultBubble)}
            </div>
          );
        }

        return (
          <div
            key={message.id}
            data-message-id={message.id}
            className={
              isActive
                ? "rounded-xl ring-2 ring-[var(--color-accent)]/50 ring-offset-2 ring-offset-transparent transition-shadow"
                : undefined
            }
          >
            <MessageBubble
              message={message}
              onCopy={handleCopy}
              isCopied={isCopied}
              showSenderInfo={showSenderInfo}
              currentUserId={currentUserId}
            />
          </div>
        );
      })}
      {showAgentWorkingIndicator && (
        <AgentWorkingIndicator
          label={normalizeAgentStatusLabel(lastAgentStatus)}
        />
      )}
      <div ref={endOfMessagesRef} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M10.5 3.5H12C12.8284 3.5 13.5 4.17157 13.5 5V12C13.5 12.8284 12.8284 13.5 12 13.5H7C6.17157 13.5 5.5 12.8284 5.5 12V10.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <rect x="2.5" y="2.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 8L6.5 11.5L13 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// MessageBubble (the default renderer)
// ---------------------------------------------------------------------------

interface MessageBubbleProps {
  message: Message;
  onCopy: (messageId: string, content: string) => void;
  isCopied: boolean;
  extraActions?: ReactNode;
  senderNameOverride?: string;
  showSenderInfo?: boolean;
  currentUserId?: string;
}

function MessageBubble({ message, onCopy, isCopied, extraActions, senderNameOverride, showSenderInfo, currentUserId }: MessageBubbleProps) {
  const isHelper = !message.user || !!message.legacy_agent || !!message.agent;
  const isSelf = !isHelper && !!currentUserId && resolveId(message.user) === currentUserId;
  const showProfile = showSenderInfo && (isHelper || !isSelf);
  const senderName = showProfile ? (senderNameOverride || getSenderName(message)) : "";
  const senderAvatarUrl = showProfile ? getSenderAvatarUrl(message) : null;
  // message.agent in JSON = agent_user_id (same as TeamMember.agentId).
  // actors[0].id has an "agent-" prefix so would hash differently — don't use it.
  const senderId = (typeof message.agent === "string" ? message.agent : undefined) || resolveId(message.user) || "";

  const bubbleColor = isHelper || !isSelf
    ? "bg-[var(--color-warm-gray)] text-[var(--color-text)]"
    : "bg-[var(--color-accent)] text-white";
  const bubbleWidth = isSelf
    ? "max-w-[85%] sm:max-w-[75%] md:max-w-[65%] lg:max-w-[55%]"
    : "max-w-full";

  const bubble = (
    <div
      className={`rounded-2xl px-3 py-2 min-w-[120px] ${bubbleColor} ${bubbleWidth}`}
    >
      {message.content && (
        <div className={`text-sm markdown-content ${isSelf ? "text-white [&_a]:text-white [&_a]:underline [&_strong]:text-white [&_em]:text-white/80" : "text-[var(--color-text)]"}`}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
            components={{
              h1: ({ children }) => (
                <h1 className="text-base font-bold mb-2 mt-4 first:mt-0 text-[var(--color-text)] border-b border-[var(--color-border)] pb-1">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-base font-bold mb-2 mt-3 first:mt-0 text-[var(--color-text)]">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-sm font-bold mb-1.5 mt-2.5 first:mt-0 text-[var(--color-text)]">
                  {children}
                </h3>
              ),
              h4: ({ children }) => (
                <h4 className="text-sm font-semibold mb-1.5 mt-2.5 first:mt-0 text-[var(--color-text-muted)]">
                  {children}
                </h4>
              ),
              h5: ({ children }) => (
                <h5 className="text-sm font-semibold mb-1.5 mt-2 first:mt-0 text-[var(--color-text-muted)]">
                  {children}
                </h5>
              ),
              h6: ({ children }) => (
                <h6 className="text-sm font-semibold mb-1.5 mt-2 first:mt-0 text-[var(--color-text-muted)]">
                  {children}
                </h6>
              ),
              p: ({ children }) => (
                <p className="mb-2.5 last:mb-0 leading-relaxed">{children}</p>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-[var(--color-text)]">
                  {children}
                </strong>
              ),
              em: ({ children }) => (
                <em className="italic text-[var(--color-text-muted)]">
                  {children}
                </em>
              ),
              ul: ({ children }) => (
                <ul className="list-disc ml-5 mb-3 space-y-1.5 marker:text-[var(--color-accent)]">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal ml-5 mb-3 space-y-1.5 marker:text-[var(--color-accent)] marker:font-semibold">
                  {children}
                </ol>
              ),
              li: ({ children }) => (
                <li className="text-sm leading-relaxed pl-1">{children}</li>
              ),
              code: ({ className, children, ...rest }) => {
                // react-markdown wraps fenced code in <pre><code>. The same
                // `code` component fires for both inline (`foo`) and block
                // (```foo```) code, so we have to disambiguate or block code
                // gets the inline pill style (one ugly background per line).
                //
                // Detection: a fenced block has either a `language-*` class
                // (labeled fence) OR a newline in its text content (any fence).
                const text = String(
                  Array.isArray(children) ? children.join("") : children ?? "",
                );
                const isBlock =
                  (typeof className === "string" && /language-/.test(className)) ||
                  text.includes("\n");
                if (isBlock) {
                  // Plain — the parent <pre> wrapper handles styling.
                  return <code className={className}>{children}</code>;
                }
                return (
                  <code
                    className="bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-[var(--color-accent)] px-1.5 py-0.5 rounded text-xs font-mono border border-[color-mix(in_srgb,var(--color-accent)_20%,transparent)]"
                    {...rest}
                  >
                    {children}
                  </code>
                );
              },
              pre: ({ children }) => (
                // rehype-highlight + github.css apply token colors to the
                // inner <code class="hljs ...">. We override the theme's
                // white background with a soft Stripe-style #f6f8fa gray
                // and add a subtle border so the block reads as its own
                // panel inside the chat bubble.
                <pre className="rounded-lg overflow-x-auto mb-3 text-xs leading-relaxed border border-[#e5e7eb] [&>code.hljs]:rounded-lg [&>code.hljs]:p-4 [&>code.hljs]:block [&>code.hljs]:!bg-[#f6f8fa] [&>code.hljs]:text-[#24292f]">
                  {children}
                </pre>
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-3 border-[var(--color-accent)] bg-[var(--color-warm-gray)] pl-4 pr-3 py-2 italic my-3 text-[var(--color-text-muted)]">
                  {children}
                </blockquote>
              ),
              a: ({ href, children }) => {
                const internal = isInternalHelperLink(href);
                return (
                  <a
                    href={href}
                    className="text-[var(--color-accent)] font-medium underline hover:no-underline hover:opacity-80"
                    target={internal ? undefined : "_blank"}
                    rel={internal ? undefined : "noopener noreferrer"}
                  >
                    {children}
                  </a>
                );
              },
              table: ({ children }) => (
                <table className="border-collapse border border-[var(--color-border)] my-3 text-sm w-full">
                  {children}
                </table>
              ),
              thead: ({ children }) => (
                <thead className="bg-[var(--color-warm-gray)]">
                  {children}
                </thead>
              ),
              tbody: ({ children }) => (
                <tbody className="divide-y divide-[var(--color-border)]">
                  {children}
                </tbody>
              ),
              tr: ({ children }) => (
                <tr className="even:bg-[var(--color-warm-gray)]">
                  {children}
                </tr>
              ),
              th: ({ children }) => (
                <th className="border border-[var(--color-border)] px-3 py-2 text-left font-bold bg-[var(--color-warm-gray)]">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-[var(--color-border)] px-3 py-2">
                  {children}
                </td>
              ),
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      )}
      {!message.content && (
        <p className="whitespace-pre-wrap text-sm opacity-60">(empty message)</p>
      )}
      {/* Attachments — only render file/image/media types, not actions/tasks/artifacts */}
      {message.attachments && message.attachments.length > 0 && (
        <div className="mt-2 space-y-2">
          {message.attachments.filter((a) => {
            const t = a.type;
            return t === "file" || t === "image" || t === "media" || a.content_type != null;
          }).map((attachment) => {
            const isImage =
              attachment.content_type?.startsWith("image/") ||
              attachment.type === "image";
            const url =
              attachment.url || attachment.image_url || attachment.image_source?.url;

            if (isImage && url) {
              return (
                <a
                  key={attachment.id}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    src={url}
                    alt={attachment.filename || "Image"}
                    className="max-h-48 rounded-lg border border-[var(--color-border)]"
                    loading="lazy"
                  />
                </a>
              );
            }

            return (
              <a
                key={attachment.id}
                href={url || undefined}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-warm-gray)] px-3 py-2 text-xs ${
                  url
                    ? "hover:opacity-80 transition-colors"
                    : "pointer-events-none"
                }`}
              >
                <svg className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a3 3 0 0 0 4.241 4.243l7.001-7.001a1 1 0 1 1 1.414 1.414l-7 7.001a5 5 0 0 1-7.072-7.072l7-7a3 3 0 0 1 4.243 4.243l-7.001 7a1 1 0 0 1-1.414-1.414l7-7.001a1 1 0 0 0 0-1.413Z" clipRule="evenodd" />
                </svg>
                <span className="truncate text-[var(--color-text)]">
                  {attachment.filename || attachment.name || attachment.title || "File"}
                </span>
                {attachment.content_type && (
                  <span className="shrink-0 text-[var(--color-text-muted)]">
                    {attachment.content_type.split("/").pop()}
                  </span>
                )}
              </a>
            );
          })}
        </div>
      )}
      {isSelf ? (
        <p className="mt-1 text-xs opacity-60" suppressHydrationWarning>
          {formatTime(message.created_at)}
        </p>
      ) : (
        <div className="flex items-center justify-between mt-1">
          <p className="text-xs opacity-60" suppressHydrationWarning>
            {formatTime(message.created_at)}
          </p>
          <div className="flex items-center gap-1.5">
            {extraActions}
            <button
              onClick={() => onCopy(message.id, message.content || "")}
              className="text-xs opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
              aria-label={isCopied ? "Copied" : "Copy message"}
              title={isCopied ? "Copied!" : "Copy message"}
            >
              {isCopied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // Self user messages: right-aligned, no sender info
  if (!isHelper && isSelf) {
    return (
      <div className="flex justify-end">
        {bubble}
      </div>
    );
  }

  // Other user messages: left-aligned with sender info (like helper messages)
  if (!isHelper && !isSelf) {
    return (
      <div className="flex items-start gap-2 justify-start">
        {showProfile && (
          <div className="w-7 shrink-0 pt-5">
            {senderName ? <SenderAvatar name={senderName} url={senderAvatarUrl} senderId={senderId} /> : <div className="w-7" />}
          </div>
        )}
        <div className="flex flex-col items-start min-w-0">
          {showProfile && senderName && (
            <p className="text-xs font-medium text-[var(--color-text-muted)] mb-0.5 px-1">
              {senderName}
            </p>
          )}
          {bubble}
        </div>
      </div>
    );
  }

  // Helper messages: avatar + name above bubble
  return (
    <div className="flex items-start gap-2 justify-start">
      {showProfile && (
        <div className="w-7 shrink-0 pt-5">
          {senderName ? <SenderAvatar name={senderName} url={senderAvatarUrl} senderId={senderId} /> : <div className="w-7" />}
        </div>
      )}
      <div className="flex flex-col items-start min-w-0">
        {showProfile && senderName && (
          <p className="text-xs font-medium text-[var(--color-text-muted)] mb-0.5 px-1">
            {senderName}{(message.legacy_agent || message.agent) ? " · Helper" : ""}
          </p>
        )}
        {bubble}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sender info
// ---------------------------------------------------------------------------

const AVATAR_COLORS = [
  "#7c5cff", // purple (original accent)
  "#2563eb", // blue
  "#0891b2", // cyan
  "#059669", // emerald
  "#d97706", // amber
  "#dc2626", // red
  "#c026d3", // fuchsia
  "#4f46e5", // indigo
  "#0d9488", // teal
  "#ea580c", // orange
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function SenderAvatar({ name, url, senderId }: { name: string; url?: string | null; senderId?: string }) {
  const initial = name.charAt(0).toUpperCase() || "?";

  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className="w-7 h-7 rounded-full object-cover"
      />
    );
  }

  const colorKey = senderId || name;
  const color = AVATAR_COLORS[hashString(colorKey) % AVATAR_COLORS.length];

  return (
    <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: color }}>
      <span className="text-white text-xs font-semibold">{initial}</span>
    </div>
  );
}

/** Extract sender display name. The `user` field is typed as string in the SDK
 *  schema but may arrive as an expanded user object from some API responses. */
function getSenderName(message: Message): string {
  // Runtime: user can be string ID or expanded object depending on API response
  const raw = message.user as unknown;
  const user = (raw && typeof raw === "object") ? raw as { name?: string; alias?: string; email?: string } : undefined;
  if (user?.name) return user.name;
  if (user?.alias) return user.alias;
  if (user?.email) return user.email;
  const actor = message.actors?.[0];
  if (actor?.name) return actor.name;
  if (actor?.alias) return actor.alias;
  if (message.legacy_agent || message.agent) return "Helper";
  return "";
}

function getSenderAvatarUrl(message: Message): string | null {
  const raw = message.user as unknown;
  const user = (raw && typeof raw === "object") ? raw as { profile_picture?: { url?: string } } : undefined;
  const fromUser = user?.profile_picture?.url;
  if (fromUser) return fromUser;
  const actor = message.actors?.[0];
  return actor?.profile_picture?.url ?? null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(isoString: string | undefined): string {
  try {
    const date = parseServerTimestamp(isoString);
    if (!date) return "";
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function parseAgentTag(content: string | null | undefined): string | null {
  const trimmed = (content ?? "").trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^<agent>([\s\S]*?)<\/agent>$/i);
  if (!match) return null;

  const value = match[1]?.trim();
  return value && value.length > 0 ? value : null;
}

function isAgentStatusMessage(message: Message): boolean {
  if (!message.legacy_agent && !message.agent) return false;
  return parseAgentTag(message.content) !== null;
}

function isMessageComplete(message: Message): boolean {
  const metadata = message.metadata as
    | { complete?: boolean }
    | null
    | undefined;
  return metadata?.complete === true;
}

function normalizeAgentStatusLabel(value: string | null): string {
  if (!value) return "Working";
  const normalized = value.trim();
  if (!normalized) return "Working";
  if (normalized.toLowerCase() === "thinking") return "Working";
  return normalized;
}

function isInternalHelperLink(href?: string): boolean {
  if (!href) return false;
  return href.startsWith("/") || href.startsWith("#");
}

// ---------------------------------------------------------------------------
// Agent working indicator
// ---------------------------------------------------------------------------

const AGENT_DOT_STYLES = `
.archastro-agent-dot {
  width: 4px;
  height: 4px;
  border-radius: 9999px;
  background: currentColor;
  opacity: 0.3;
  animation: archastroAgentDotPulse 900ms infinite ease-in-out;
}

@keyframes archastroAgentDotPulse {
  0%, 100% {
    transform: translateY(0);
    opacity: 0.25;
  }
  50% {
    transform: translateY(-2px);
    opacity: 0.8;
  }
}
`;

function AgentWorkingIndicator({ label }: { label: string }) {
  return (
    <div className="flex justify-start">
      <div
        className="max-w-full rounded-2xl bg-[var(--color-warm-gray)] px-3 py-2 text-[var(--color-text)]"
        aria-label={`Helper ${label.toLowerCase()}`}
      >
        <div className="flex items-center gap-2 text-sm">
          <span className="opacity-80">{label}</span>
          <span className="inline-flex items-center gap-1" aria-hidden="true">
            <span
              className="archastro-agent-dot"
              style={{ animationDelay: "0ms" }}
            />
            <span
              className="archastro-agent-dot"
              style={{ animationDelay: "180ms" }}
            />
            <span
              className="archastro-agent-dot"
              style={{ animationDelay: "360ms" }}
            />
          </span>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: AGENT_DOT_STYLES }} />
    </div>
  );
}
