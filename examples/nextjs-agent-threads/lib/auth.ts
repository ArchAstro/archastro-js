"use server";

import { redirect } from "next/navigation";
import {
  createAuthActions,
  createSessionManager,
} from "@archastro/sdk-nextjs/server";
import { getConfig } from "./config";

const config = getConfig();
const actions = createAuthActions(config);
const sessionManager = createSessionManager(config);

export const register = actions.register;
export const loginWithPassword = actions.loginWithPassword;
export const handleMagicLink = actions.handleMagicLink;
export const refreshSession = actions.refreshSession;

export async function logout() {
  await actions.logout();
  redirect("/login");
}

export const getServerClient = sessionManager.getServerClient;
