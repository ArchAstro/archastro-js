import { redirect } from "next/navigation";
import Link from "next/link";
import type { Message } from "@archastro/sdk";
import { getServerClient } from "../../../lib/auth";
import { ShareThreadButton } from "../../../components/ShareThreadButton";
import { ThreadChat } from "../../../components/ThreadChat";

interface Props {
  params: Promise<{ threadId: string }>;
}

export default async function ThreadPage({ params }: Props) {
  const { threadId } = await params;
  const client = await getServerClient();

  if (!client) {
    redirect("/login");
  }

  const me = await client.users.me();

  // Auto-join: best-effort add of the current user as a member.
  // The platform rejects duplicates with a 409, which we ignore.
  try {
    await client.threads.members.create(threadId, {
      type: "user",
      user_id: me.id,
      membership_type: "member",
    });
  } catch {
    // already a member
  }

  const [thread, messagesPage] = await Promise.all([
    client.threads.get(threadId),
    client.threads.messages(threadId, { limit: 50 }),
  ]);

  const initialMessages = (messagesPage.data.messages ?? []) as Message[];

  return (
    <div className="thread-chat-page">
      <Link href="/threads" className="back-link">
        &larr; All Threads
      </Link>

      <div className="thread-header">
        <div className="thread-header-row">
          <h1>{thread.title}</h1>
          <ShareThreadButton threadId={thread.id} />
        </div>
        {thread.description && <p>{thread.description}</p>}
      </div>

      <ThreadChat thread={thread} initialMessages={initialMessages} />
    </div>
  );
}
