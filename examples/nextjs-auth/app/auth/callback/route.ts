import { NextRequest, NextResponse } from "next/server";
import { handleMagicLink } from "../../../lib/auth";

/**
 * Handle magic link callbacks.
 * URL format: /auth/callback?token=<one-time-token>&next=/dashboard
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? url.searchParams.get("n");
  const next = url.searchParams.get("next") ?? "/dashboard";

  if (!token) {
    return NextResponse.redirect(new URL("/login?error=missing_token", url));
  }

  const result = await handleMagicLink(token);

  if (!result.success) {
    const loginUrl = new URL("/login", url);
    loginUrl.searchParams.set("error", result.error ?? "invalid_token");
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(new URL(next, url));
}
