import { redirect } from "next/navigation";
import { getServerClient } from "../../lib/auth";
import { LoginForm } from "../../components/LoginForm";

interface Props {
  searchParams: Promise<{ return_to?: string }>;
}

function safeReturnTo(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/threads";
  }
  return raw;
}

export default async function LoginPage({ searchParams }: Props) {
  const { return_to } = await searchParams;
  const target = safeReturnTo(return_to);
  const client = await getServerClient();

  if (client) {
    redirect(target);
  }

  return (
    <div>
      <LoginForm returnTo={target} />
    </div>
  );
}
