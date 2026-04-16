import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerClient } from "../../lib/auth";
import { UserProfile } from "../../components/UserProfile";

export default async function DashboardPage() {
  const client = await getServerClient();

  if (!client) {
    redirect("/login");
  }

  const user = await client.users.me();

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome back!</p>

      <UserProfile />

      <hr style={{ margin: "2rem 0", border: "none", borderTop: "1px solid #eee" }} />

      <nav>
        <Link href="/profile">View Profile →</Link>
      </nav>

      <hr style={{ margin: "2rem 0", border: "none", borderTop: "1px solid #eee" }} />

      <h2>Server Data</h2>
      <pre
        style={{
          background: "#f5f5f5",
          padding: "1rem",
          borderRadius: "4px",
          overflow: "auto",
        }}
      >
        {JSON.stringify(user, null, 2)}
      </pre>
    </div>
  );
}
