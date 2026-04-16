import { redirect } from "next/navigation";
import { getServerClient } from "../../lib/auth";
import { LoginForm } from "../../components/LoginForm";

export default async function LoginPage() {
  const client = await getServerClient();

  if (client) {
    redirect("/threads");
  }

  return (
    <div>
      <LoginForm />
    </div>
  );
}
