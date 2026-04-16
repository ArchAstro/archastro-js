"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { loginWithPassword, register } from "../lib/auth";
import { useRefreshSession } from "@archastro/sdk-nextjs/client";

type Mode = "login" | "register";

export function LoginForm() {
  const router = useRouter();
  const refreshSession = useRefreshSession();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result =
        mode === "login"
          ? await loginWithPassword(email, password)
          : await register({
              email,
              password,
              full_name: name,
              alias: name.split(" ")[0].toLowerCase(),
            });

      if (result.success) {
        await refreshSession();
        router.push("/threads");
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong");
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === "login" ? "register" : "login");
    setError(null);
  };

  return (
    <div className="login-form">
      <form onSubmit={handleSubmit}>
        <h2>{mode === "login" ? "Log In" : "Create Account"}</h2>
        <p>
          {mode === "login"
            ? "Sign in to browse agent threads."
            : "Create an account to get started."}
        </p>

        {mode === "register" && (
          <>
            <label htmlFor="name">Full Name</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              required
              disabled={loading}
            />
          </>
        )}

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          disabled={loading}
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "register" ? "Choose a password" : "Your password"}
          required
          disabled={loading}
        />

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={loading}>
          {loading
            ? mode === "login"
              ? "Signing in..."
              : "Creating account..."
            : mode === "login"
              ? "Sign In"
              : "Create Account"}
        </button>

        <button
          type="button"
          onClick={toggleMode}
          disabled={loading}
          className="secondary"
        >
          {mode === "login"
            ? "Don't have an account? Sign up"
            : "Already have an account? Log in"}
        </button>
      </form>
    </div>
  );
}
