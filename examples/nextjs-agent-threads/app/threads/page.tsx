import { redirect } from "next/navigation";
import type { Thread } from "@archastro/sdk";
import { getServerClient } from "../../lib/auth";
import { ThreadList } from "../../components/ThreadList";

export default async function ThreadsPage() {
  const client = await getServerClient();

  if (!client) {
    redirect("/login");
  }

  const me = await client.users.me();
  const { data } = await client.users.threads.list(me.id);

  // Hide the user's default + unlisted housekeeping threads.
  const visibleThreads = (data as Thread[]).filter(
    (t) => !t.is_default && !t.is_unlisted,
  );

  return <ThreadList threads={visibleThreads} />;
}
