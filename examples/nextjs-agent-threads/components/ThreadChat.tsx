"use client";

import { ChatThread } from "@archastro/sdk-nextjs/chat";
import type { Thread, Message, ThreadAction } from "@archastro/sdk";

interface Props {
  thread: Thread;
  initialMessages: Message[];
  actions: ThreadAction[];
}

export function ThreadChat({ thread, initialMessages, actions }: Props) {
  return (
    <ChatThread
      thread={thread}
      initialMessages={initialMessages}
      actions={actions}
    />
  );
}
