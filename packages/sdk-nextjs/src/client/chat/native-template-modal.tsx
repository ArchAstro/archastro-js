"use client";

import { useCallback, useEffect, useState } from "react";
import type { ThreadAction } from "@archastro/sdk";
import type { ParsedAction, NativeTemplateComponent } from "@archastro/native-templates-core";
import { NativeTemplateRenderer } from "@archastro/native-templates-react";
import { getThreadActionPresentation } from "./thread-action-registry.js";
import type { NativeTemplateModalProps } from "./types.js";

function getErrorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const maybeError = err as Record<string, unknown>;
    if (typeof maybeError.response === "object" && maybeError.response !== null) {
      const response = maybeError.response as Record<string, unknown>;
      if (typeof response.data === "object" && response.data !== null) {
        const data = response.data as Record<string, unknown>;
        if (typeof data.error === "string") {
          return data.error;
        }
      }
    }
    if (typeof maybeError.message === "string") {
      return maybeError.message;
    }
  }
  return "Something went wrong. Please try again.";
}

export function NativeTemplateModal({
  open,
  action,
  thread,
  onClose,
  onComplete,
}: NativeTemplateModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  const nativeTemplate = action?.native_template;
  const visible = open && Boolean(nativeTemplate?.component) && Boolean(thread);

  const presentation = action
    ? getThreadActionPresentation(action)
    : { title: "Action" };

  const label =
    action?.type === "send_email" ? "Send Email" : presentation.title;

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    setError(null);
    setIsSubmitting(false);
    setActiveAction(null);
  }, [open, action?.id]);

  const handleAction = useCallback(
    async (parsedAction: ParsedAction) => {
      if (!action?.id || !thread || !onComplete) {
        setError("Missing action or thread context.");
        return;
      }

      setActiveAction(parsedAction.name);
      setIsSubmitting(true);
      setError(null);

      const payload = {
        ...parsedAction.params,
        action: parsedAction.name,
      };

      try {
        await onComplete(payload);
        onClose();
      } catch (submitError: unknown) {
        setError(getErrorMessage(submitError));
      } finally {
        setIsSubmitting(false);
        setActiveAction(null);
      }
    },
    [action, thread, onComplete, onClose],
  );

  if (!nativeTemplate?.component) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 z-50 ${
        visible ? "pointer-events-auto" : "pointer-events-none"
      }`}
      aria-hidden={!visible}
    >
      {/* Backdrop */}
      <div
        data-testid="modal-backdrop"
        className={`absolute inset-0 bg-slate-900/40 transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      {isMobile ? (
        <div
          className={`absolute inset-x-0 bottom-0 transform transition-transform duration-300 ${
            visible ? "translate-y-0" : "translate-y-full"
          }`}
        >
          <div className="mx-auto w-full max-w-xl rounded-t-3xl bg-white p-6 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-slate-200" />
            <ModalContent
              label={label}
              nativeTemplate={nativeTemplate}
              error={error}
              disabled={isSubmitting}
              activeAction={activeAction}
              onClose={onClose}
              onAction={handleAction}
            />
          </div>
        </div>
      ) : (
        <div
          className={`absolute inset-0 flex items-center justify-center p-4 transition-opacity duration-300 ${
            visible ? "opacity-100" : "opacity-0"
          }`}
        >
          <div
            className={`w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl max-h-[85vh] overflow-y-auto transform transition-transform duration-300 ${
              visible ? "scale-100" : "scale-95"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <ModalContent
              label={label}
              nativeTemplate={nativeTemplate}
              error={error}
              disabled={isSubmitting}
              activeAction={activeAction}
              onClose={onClose}
              onAction={handleAction}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModalContent
// ---------------------------------------------------------------------------

interface ModalContentProps {
  label: string;
  nativeTemplate: NonNullable<ThreadAction["native_template"]>;
  error: string | null;
  disabled: boolean;
  activeAction: string | null;
  onClose: () => void;
  onAction: (action: ParsedAction) => void;
}

function ModalContent({
  label,
  nativeTemplate,
  error,
  disabled,
  activeAction,
  onClose,
  onAction,
}: ModalContentProps) {
  return (
    <>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Review & Confirm
          </p>
          <h3 className="text-xl font-semibold text-slate-900">{label}</h3>
        </div>
        <button
          type="button"
          aria-label="Close"
          className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
          onClick={onClose}
          disabled={disabled}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="space-y-4">
        <div className="text-base">
          <NativeTemplateRenderer
            component={nativeTemplate.component as NativeTemplateComponent}
            onAction={onAction}
            disabled={disabled}
            activeAction={activeAction}
          />
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    </>
  );
}

function CloseIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  );
}
