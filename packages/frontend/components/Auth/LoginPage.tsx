/**
 * LoginPage — Simple email/password auth form.
 * Handles both sign-in and sign-up flows.
 */

import React, { useState } from "react";
import { signIn, signUp } from "../../lib/auth-client";

const GitHubIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 8 }}>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
  </svg>
);

export function LoginPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isSignUp) {
        const result = await signUp.email({
          email,
          password,
          name: name || email.split("@")[0],
        });
        if (result.error) {
          setError(result.error.message || "Sign up failed");
        }
      } else {
        const result = await signIn.email({ email, password });
        if (result.error) {
          setError(result.error.message || "Sign in failed");
        }
      }
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#0f172a",
        color: "#e2e8f0",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          padding: "40px",
          borderRadius: "12px",
          background: "#1e293b",
          border: "1px solid #334155",
          width: "360px",
        }}
      >
        <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0, textAlign: "center" }}>
          {"Ping"}
        </h1>
        <p style={{ fontSize: "14px", color: "#94a3b8", margin: 0, textAlign: "center" }}>
          {isSignUp ? "Create a new Ping account" : "Sign in to Ping"}
        </p>

        {isSignUp && (
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
          />
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          style={inputStyle}
        />

        {error && (
          <p style={{ color: "#ef4444", fontSize: "13px", margin: 0 }}>{error}</p>
        )}

        <button type="submit" disabled={loading} style={buttonStyle}>
          {loading ? "..." : isSignUp ? "Sign Up" : "Sign In"}
        </button>

        <button
          type="button"
          onClick={() => { setIsSignUp(!isSignUp); setError(null); }}
          style={{ background: "none", border: "none", color: "#60a5fa", cursor: "pointer", fontSize: "13px" }}
        >
          {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "4px 0" }}>
          <div style={{ flex: 1, height: "1px", background: "#475569" }} />
          <span style={{ fontSize: "12px", color: "#64748b" }}>or</span>
          <div style={{ flex: 1, height: "1px", background: "#475569" }} />
        </div>

        <button
          type="button"
          onClick={() => signIn.social({
            provider: "github",
            callbackURL: window.location.origin,
          })}
          style={{
            ...buttonStyle,
            background: "#24292f",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <GitHubIcon />
          Sign in with GitHub
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: "8px",
  border: "1px solid #475569",
  background: "#0f172a",
  color: "#e2e8f0",
  fontSize: "14px",
  outline: "none",
};

const buttonStyle: React.CSSProperties = {
  padding: "10px",
  borderRadius: "8px",
  border: "none",
  background: "#3b82f6",
  color: "#fff",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer",
};
