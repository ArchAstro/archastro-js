"use client";

import { useState } from "react";
import { createThreadInvite } from "../lib/invites";

interface Props {
  threadId: string;
}

type Status =
  | { kind: "idle" }
  | { kind: "minting" }
  | { kind: "ready"; url: string; copied: boolean }
  | { kind: "error"; message: string };

export function ShareThreadButton({ threadId }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const mintInvite = async () => {
    setStatus({ kind: "minting" });
    const result = await createThreadInvite(threadId);
    if (!result.success) {
      setStatus({ kind: "error", message: result.error });
      return;
    }
    const url = `${window.location.origin}/invites/${encodeURIComponent(result.key)}`;
    try {
      await navigator.clipboard.writeText(url);
      setStatus({ kind: "ready", url, copied: true });
    } catch {
      setStatus({ kind: "ready", url, copied: false });
    }
  };

  if (status.kind === "ready") {
    return (
      <div className="invite-ready">
        <input
          type="text"
          readOnly
          value={status.url}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(status.url);
              setStatus({ ...status, copied: true });
            } catch {
              // ignore
            }
          }}
        >
          {status.copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => setStatus({ kind: "idle" })}
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="invite-control">
      <button type="button" onClick={mintInvite} disabled={status.kind === "minting"}>
        {status.kind === "minting" ? "Creating link..." : "Share"}
      </button>
      {status.kind === "error" && <p className="error">{status.message}</p>}
    </div>
  );
}
