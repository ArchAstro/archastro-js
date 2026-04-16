import { redirect } from "next/navigation";
import { getServerClient } from "../../lib/auth";
import { LoginForm } from "../../components/LoginForm";

export default async function LoginPage() {
  const client = await getServerClient();

  if (client) {
    // Already logged in, redirect to dashboard
    redirect("/dashboard");
  }

  return (
    <div>
      <LoginForm />
    </div>
  );
}
