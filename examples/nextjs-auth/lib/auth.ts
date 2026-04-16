"use server";

import { redirect } from "next/navigation";
import {
  createAuthActions,
  createSessionManager,
  createFederatedAuth,
} from "@archastro/sdk-nextjs/server";
import { getConfig } from "./config";

const config = getConfig();
const actions = createAuthActions(config);
const sessionManager = createSessionManager(config);

const federatedAuth = createFederatedAuth({
  apiBaseUrl: config.apiBaseURL,
  publishableKey: config.publishableKey,
});

export const loginWithPassword = actions.loginWithPassword;
export const register = actions.register;
export const handleMagicLink = actions.handleMagicLink;
export const refreshSession = actions.refreshSession;

export async function logout() {
  await actions.logout();
  redirect("/login");
}

export const getServerClient = sessionManager.getServerClient;

export async function loginWithGoogle() {
  await federatedAuth.startFederatedLogin("google", {
    fallbackOrigin: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  });
}

export async function loginWithGitHub() {
  await federatedAuth.startFederatedLogin("github", {
    fallbackOrigin: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  });
}
