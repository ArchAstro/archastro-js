"use client";

import type { ThreadAction } from "@archastro/sdk";
import { InlineActionCard } from "./inline-action-card.js";
import { isPendingThreadAction } from "./thread-action-registry.js";
import type { InlineActionsListProps } from "./types.js";

function isInlineEligible(action: ThreadAction): boolean {
  return Boolean(action.native_template?.component);
}

export function InlineActionsList({
  actions,
  threadId,
  teamId,
  onRunAction,
  onDismissAction,
  maxVisible = 3,
  overflowHref,
}: InlineActionsListProps) {
  const pendingInlineActions = actions
    .filter(isPendingThreadAction)
    .filter(isInlineEligible);

  if (pendingInlineActions.length === 0) {
    return null;
  }

  const visibleActions = pendingInlineActions.slice(0, maxVisible);
  const hiddenCount = Math.max(
    0,
    pendingInlineActions.length - maxVisible,
  );

  const moreHref = overflowHref
    ? overflowHref(threadId)
    : `/account?thread_id=${encodeURIComponent(threadId)}&return_to=${encodeURIComponent(`/thread/${threadId}`)}`;

  return (
    <div className="mt-4 space-y-3">
      {visibleActions.map((action) => (
        <InlineActionCard
          key={action.id}
          action={action}
          threadId={threadId}
          teamId={teamId}
          onRun={onRunAction}
          onDismiss={onDismissAction}
        />
      ))}
      {hiddenCount > 0 && (
        <a
          href={moreHref}
          className="block text-center text-sm text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
        >
          +{hiddenCount} more
        </a>
      )}
    </div>
  );
}
