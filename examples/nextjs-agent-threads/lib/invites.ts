"use server";

import { getServerClient } from "./auth";

export interface CreateInviteResult {
  success: true;
  key: string;
}

export interface CreateInviteError {
  success: false;
  error: string;
}

export async function createThreadInvite(
  threadId: string,
): Promise<CreateInviteResult | CreateInviteError> {
  const client = await getServerClient();
  if (!client) {
    return { success: false, error: "Not signed in" };
  }

  try {
    const me = await client.users.me();
    const invite = await client.users.invites(me.id, {
      user: me.id,
      invite: { thread_id: threadId },
    });

    if (!invite.key) {
      return { success: false, error: "Server returned invite without a key" };
    }

    return { success: true, key: invite.key };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Failed to create invite",
    };
  }
}

export interface AcceptInviteResult {
  success: true;
  threadId: string | null;
}

export interface AcceptInviteError {
  success: false;
  error: string;
  status?: number;
}

export async function acceptInvite(
  key: string,
): Promise<AcceptInviteResult | AcceptInviteError> {
  const client = await getServerClient();
  if (!client) {
    return { success: false, error: "Not signed in", status: 401 };
  }

  try {
    const invite = await client.invites.accept({ key });
    return { success: true, threadId: invite.thread ?? null };
  } catch (e) {
    const status =
      typeof e === "object" && e !== null && "status" in e
        ? (e as { status?: number }).status
        : undefined;
    return {
      success: false,
      error: e instanceof Error ? e.message : "Failed to accept invite",
      status,
    };
  }
}
