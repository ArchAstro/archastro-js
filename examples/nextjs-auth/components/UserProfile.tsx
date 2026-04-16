"use client";

import { useCurrentUser } from "@archastro/sdk-nextjs/client";
import { logout } from "../lib/auth";

export function UserProfile() {
  const user = useCurrentUser();

  if (!user) {
    return (
      <div className="user-profile">
        <p>Not logged in</p>
        <a href="/login">Log In</a>
      </div>
    );
  }

  const displayName = user.name ?? user.alias ?? user.email ?? user.id;
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="user-profile">
      <div className="avatar">
        <span>{initial}</span>
      </div>
      <h3>{displayName}</h3>
      {user.email && <p>{user.email}</p>}
      <form action={logout}>
        <button type="submit">Log Out</button>
      </form>
    </div>
  );
}
