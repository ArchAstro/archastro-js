"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type KeyboardEvent,
  type DragEvent,
} from "react";
import type { ChatInputProps, MessageUploadInput } from "./types.js";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ACCEPTED_FILE_TYPES =
  "image/*,.pdf,.txt,.md,.csv,.json,.zip,.doc,.docx,.ppt,.pptx,.xls,.xlsx";

interface PendingAttachment {
  id: string;
  file: File;
  previewUrl: string | null;
}

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = "Reply to your helper...",
}: ChatInputProps) {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [content, adjustHeight]);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      setAttachmentError(null);
      const fileArray = Array.from(files);
      const tooLarge = fileArray.filter((f) => f.size > MAX_UPLOAD_BYTES);
      if (tooLarge.length > 0) {
        setAttachmentError(
          `File${tooLarge.length > 1 ? "s" : ""} exceed 15 MB limit: ${tooLarge.map((f) => f.name).join(", ")}`,
        );
        return;
      }

      const newAttachments: PendingAttachment[] = fileArray.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        file,
        previewUrl: file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : null,
      }));

      setAttachments((prev) => [...prev, ...newAttachments]);
    },
    [],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = content.trim();
    const hasAttachments = attachments.length > 0;
    if ((!trimmed && !hasAttachments) || sending) return;

    setSending(true);
    try {
      let uploads: MessageUploadInput[] | undefined;
      if (hasAttachments) {
        uploads = attachments.map((a) => ({
          name: a.file.name,
          mime_type: a.file.type || "application/octet-stream",
          content: a.file as Blob,
        }));
      }

      await onSend(trimmed, uploads);

      // Clean up preview URLs
      for (const a of attachments) {
        if (a.previewUrl) {
          URL.revokeObjectURL(a.previewUrl);
        }
      }

      setContent("");
      setAttachments([]);
      setAttachmentError(null);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } finally {
      setSending(false);
    }
  }, [content, attachments, sending, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const hasContent = content.trim().length > 0 || attachments.length > 0;

  return (
    <div>
      {/* Hidden file input — kept outside flex layout to avoid sizing interference */}
      <input
        ref={fileInputRef}
        type="file"
        hidden
        multiple
        accept={ACCEPTED_FILE_TYPES}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            addFiles(e.target.files);
          }
          // Reset so the same file can be re-selected
          e.target.value = "";
        }}
      />

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`rounded-2xl border transition-colors ${
          isDragging
            ? "border-[var(--color-accent)] bg-[var(--color-accent-light)]"
            : "border-[var(--color-border)]"
        } focus-within:border-[var(--color-accent)] focus-within:ring-2 focus-within:ring-[var(--color-accent-light)]`}
      >
        <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", padding: "4px 8px" }}>
          {/* Paperclip / attach button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || sending}
            aria-label="Attach file"
            style={{ flex: "0 0 38px", height: "38px", width: "38px" }}
            className="flex items-center justify-center self-end rounded-full text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)] disabled:opacity-50"
          >
            <svg
              className="h-[18px] w-[18px]"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a3 3 0 0 0 4.241 4.243l7.001-7.001a1 1 0 1 1 1.414 1.414l-7 7.001a5 5 0 0 1-7.072-7.072l7-7a3 3 0 0 1 4.243 4.243l-7.001 7a1 1 0 0 1-1.414-1.414l7-7.001a1 1 0 0 0 0-1.413Z"
                clipRule="evenodd"
              />
            </svg>
          </button>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled || sending}
            rows={1}
            style={{ flex: "1 1 0%", minWidth: 0 }}
            className="resize-none border-0 bg-transparent px-2 py-2 text-base text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] leading-normal max-h-[100px] sm:max-h-[150px] focus:outline-none disabled:bg-[var(--color-warm-gray)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          />

          {/* Send button */}
          <button
            type="button"
            onClick={handleSend}
            disabled={disabled || sending}
            aria-label="Send message"
            style={{ flex: "0 0 38px", height: "38px", width: "38px" }}
            className={`flex items-center justify-center self-end rounded-full transition-colors ${
              hasContent
                ? "bg-[var(--color-accent)] text-white hover:opacity-90"
                : "bg-transparent text-[var(--color-text-muted)] cursor-default"
            }`}
          >
            <svg
              className="h-[18px] w-[18px]"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M3.105 2.29a.75.75 0 0 0-.826.95l1.414 4.925A1.5 1.5 0 0 0 5.135 9.25H10a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086L2.28 16.76a.75.75 0 0 0 .826.95l15.346-4.385a.75.75 0 0 0 0-1.44L3.105 2.29Z" />
            </svg>
          </button>
        </div>

        {/* Attachment preview strip */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pb-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-warm-gray)] px-2 py-1 text-xs"
              >
                {attachment.previewUrl ? (
                  <img
                    src={attachment.previewUrl}
                    alt={attachment.file.name}
                    className="h-6 w-6 rounded object-cover"
                  />
                ) : (
                  <svg
                    className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a3 3 0 0 0 4.241 4.243l7.001-7.001a1 1 0 1 1 1.414 1.414l-7 7.001a5 5 0 0 1-7.072-7.072l7-7a3 3 0 0 1 4.243 4.243l-7.001 7a1 1 0 0 1-1.414-1.414l7-7.001a1 1 0 0 0 0-1.413Z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
                <span className="max-w-[120px] truncate text-[var(--color-text)]">
                  {attachment.file.name}
                </span>
                <button
                  type="button"
                  onClick={() => removeAttachment(attachment.id)}
                  aria-label={`Remove ${attachment.file.name}`}
                  className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] transition-colors"
                >
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Error message */}
      {attachmentError && (
        <p className="mt-1 px-3 text-xs text-red-600">{attachmentError}</p>
      )}
    </div>
  );
}
