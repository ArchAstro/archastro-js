import { redirect } from "next/navigation";
import { getServerClient } from "../lib/auth";

export default async function HomePage() {
  const client = await getServerClient();

  if (client) {
    // User is logged in, redirect to dashboard
    redirect("/dashboard");
  }

  // User is not logged in, redirect to login
  redirect("/login");
}
