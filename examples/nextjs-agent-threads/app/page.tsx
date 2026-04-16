import { redirect } from "next/navigation";
import { getServerClient } from "../lib/auth";

export default async function HomePage() {
  const client = await getServerClient();

  if (client) {
    redirect("/threads");
  }

  redirect("/login");
}
