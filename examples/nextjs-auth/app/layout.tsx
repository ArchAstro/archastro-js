import { SDKProvider } from "@archastro/sdk-nextjs/client";
import { refreshSession } from "../lib/auth";
import { getPublicConfig } from "../lib/config";
import "./globals.css";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Fetch initial access token on the server so the client SDK starts
  // hydrated and avoids a flash of unauthenticated state.
  const session = await refreshSession();

  return (
    <html lang="en">
      <head>
        <title>Auth Example</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <SDKProvider
          config={getPublicConfig()}
          refreshSession={refreshSession}
          initialAccessToken={session?.accessToken ?? null}
        >
          <main>{children}</main>
        </SDKProvider>
      </body>
    </html>
  );
}
