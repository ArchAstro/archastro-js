"use client";

import Link from "next/link";
import type { Thread } from "@archastro/sdk";
import { logout } from "../lib/auth";

interface Props {
  threads: Thread[];
}

export function ThreadList({ threads }: Props) {
  if (threads.length === 0) {
    return (
      <div className="thread-list-page">
        <header>
          <h1>Agent Threads</h1>
          <form action={logout}>
            <button type="submit">Log Out</button>
          </form>
        </header>
        <div className="empty-state">
          <p>No threads available yet.</p>
          <p>Create threads with AI agents in your ArchAstro dashboard.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="thread-list-page">
      <header>
        <h1>Agent Threads</h1>
        <form action={logout}>
          <button type="submit">Log Out</button>
        </form>
      </header>

      <div className="thread-grid">
        {threads.map((thread) => (
          <Link
            key={thread.id}
            href={`/threads/${thread.id}`}
            className="thread-card"
          >
            <h3>{thread.title}</h3>
            {thread.description && <p>{thread.description}</p>}
            <div className="meta">
              {thread.participating_agents?.map((agent) => (
                <span key={agent.id} className="badge">
                  {agent.name}
                </span>
              ))}
              {thread.is_channel && <span className="badge">Channel</span>}
              {thread.last_activity && (
                <span>
                  Last active:{" "}
                  {new Date(thread.last_activity).toLocaleDateString()}
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
