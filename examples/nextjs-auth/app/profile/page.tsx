import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerClient } from "../../lib/auth";
import { UserProfile } from "../../components/UserProfile";

export default async function ProfilePage() {
  const client = await getServerClient();

  if (!client) {
    redirect("/login");
  }

  const user = await client.users.me();

  return (
    <div>
      <h1>Profile</h1>
      <p>This is another protected page demonstrating auth works across routes.</p>

      <UserProfile />

      <hr style={{ margin: "2rem 0", border: "none", borderTop: "1px solid #eee" }} />

      <h2>User Details</h2>
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.5rem 1rem" }}>
        <dt><strong>ID:</strong></dt>
        <dd><code>{user.id}</code></dd>

        <dt><strong>Email:</strong></dt>
        <dd>{user.email ?? <em>Not set</em>}</dd>

        <dt><strong>Name:</strong></dt>
        <dd>{user.name ?? <em>Not set</em>}</dd>

        <dt><strong>Alias:</strong></dt>
        <dd>{user.alias ?? <em>Not set</em>}</dd>
      </dl>

      <hr style={{ margin: "2rem 0", border: "none", borderTop: "1px solid #eee" }} />

      <nav>
        <Link href="/dashboard">← Back to Dashboard</Link>
      </nav>
    </div>
  );
}
