import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerClient } from "../../../lib/auth";
import { acceptInvite } from "../../../lib/invites";

interface Props {
  params: Promise<{ key: string }>;
}

export default async function InviteAcceptPage({ params }: Props) {
  const { key } = await params;
  const client = await getServerClient();

  if (!client) {
    const returnTo = `/invites/${encodeURIComponent(key)}`;
    redirect(`/login?return_to=${encodeURIComponent(returnTo)}`);
  }

  const result = await acceptInvite(key);

  if (result.success && result.threadId) {
    redirect(`/threads/${result.threadId}`);
  }

  if (result.success) {
    // Accepted but server didn't echo a thread id — fall through to the list.
    redirect("/threads");
  }

  return (
    <div className="invite-error-page">
      <h1>Invite couldn&rsquo;t be redeemed</h1>
      <p>{result.error}</p>
      {result.status === 404 && (
        <p>The invite link may be expired or already used.</p>
      )}
      <Link href="/threads" className="back-link">
        Back to threads
      </Link>
    </div>
  );
}
