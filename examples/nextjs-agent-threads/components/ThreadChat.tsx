"use client";

import { ChatThread } from "@archastro/sdk-nextjs/chat";
import type { Thread, Message } from "@archastro/sdk";

interface Props {
  thread: Thread;
  initialMessages: Message[];
}

export function ThreadChat({ thread, initialMessages }: Props) {
  return (
    <ChatThread
      thread={thread}
      initialMessages={initialMessages}
      actions={[]}
    />
  );
}
